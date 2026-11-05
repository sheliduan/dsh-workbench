/**
 * 工作台 · Host 半（M2）
 *
 * 只使用注入的 Cordis 服务（webServer / workingDirectory），不 import 任何 DSH 包。
 * M2：目标（KR）、周报/月报渲染、报告字段映射、分目录导出。
 */
import path from 'node:path'
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'

export const name = 'workbench'
export const inject = ['webServer', 'workingDirectory']

const API_PREFIX = '/workbench/api'
const DATA_CANDIDATES = ['worklog/workbench.json', '.workbench.json']
const DEFAULT_EXPORT_DIR = 'worklog/exports'
const MAX_BODY_BYTES = 512 * 1024
const TIME_ZONE = 'Asia/Shanghai'

const TEMPLATE_FIELDS = ['今日完成工作', '所用工时', '未完成工作和明天计划', '日志接收人员']

function todayKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE })
}

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date())
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || ''
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    time: get('hour') + ':' + get('minute'),
    weekday: get('weekday'),
  }
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value)
}

function isoWeekKey(dateStr) {
  const date = new Date(dateStr + 'T00:00:00Z')
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7)
  return date.getUTCFullYear() + '-W' + pad2(week)
}

function mondayOfWeekKey(weekKey) {
  const parts = String(weekKey).split('-W')
  const year = Number(parts[0])
  const week = Number(parts[1])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const day = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7)
  return monday.toISOString().slice(0, 10)
}

function addDays(dateStr, days) {
  const date = new Date(dateStr + 'T00:00:00')
  date.setDate(date.getDate() + days)
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
}

function shortDate(dateStr) {
  return dateStr.slice(5).replace('-', '/')
}

function isWeekendKey(dateStr) {
  if (!dateStr) return false
  const day = new Date(dateStr + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

function holidayMap(holidays) {
  const map = new Map()
  for (const entry of holidays || []) {
    if (entry && entry.date) map.set(String(entry.date), entry.kind === 'on' ? 'on' : 'off')
  }
  return map
}

function isOvertimeDate(dateStr, holidays) {
  if (!dateStr) return false
  const map = holidayMap(holidays)
  const marked = map.get(dateStr)
  if (marked === 'on') return false
  if (marked === 'off') return true
  return isWeekendKey(dateStr)
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function median(values) {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function normalizeSettings(input) {
  const base = {
    exportRoot: '',
    recipients: '',
    dwsPath: '',
    dingtalk: {
      templateId: '',
      templateName: '',
      fields: [],
      mapping: {
        done: '今日完成工作',
        hours: '所用工时',
        left: '未完成工作和明天计划',
        risks: '需协调工作',
      },
      recipients: [],
    },
    schedule: {
      enabled: true,
      weekdayTime: '18:00',
      fridayTime: '18:00',
      weeklyOnFriday: true,
    },
    holidays: [],
  }
  const merged = Object.assign({}, base, input || {})
  merged.schedule = Object.assign({}, base.schedule, (input && input.schedule) || {})
  if (!Array.isArray(merged.holidays)) merged.holidays = []
  const dingtalk = Object.assign({}, base.dingtalk, (input && input.dingtalk) || {})
  dingtalk.mapping = Object.assign({}, base.dingtalk.mapping, ((input && input.dingtalk) || {}).mapping || {})
  if (!Array.isArray(dingtalk.fields)) dingtalk.fields = []
  if (!Array.isArray(dingtalk.recipients)) dingtalk.recipients = []
  merged.dingtalk = dingtalk
  return merged
}

function emptyState() {
  return {
    version: 5,
    items: [],
    projects: [],
    goals: [],
    narratives: {},
    reports: [],
    runs: [],
    scheduleState: { dailyDate: '', weeklyKey: '' },
    settings: normalizeSettings(null),
    connections: { gitlab: null },
  }
}

export function apply(ctx) {
  const state = emptyState()
  let dataFile = DATA_CANDIDATES[0]
  let loading = null

  const root = () => ctx.workingDirectory.defaultDirectory
  const absolute = (rel) => (path.isAbsolute(rel) ? rel : path.join(root(), rel))

  async function readText(rel) {
    try {
      return await readFile(absolute(rel), 'utf8')
    } catch (error) {
      return null
    }
  }

  async function writeText(rel, text) {
    const target = absolute(rel)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }

  async function load() {
    for (const candidate of DATA_CANDIDATES) {
      try {
        const text = await readText(candidate)
        if (!text) continue
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object') continue
        for (const key of Object.keys(state)) {
          if (key in parsed && parsed[key] !== undefined) state[key] = parsed[key]
        }
        state.settings = normalizeSettings(state.settings)
        state.connections = Object.assign({ gitlab: null }, state.connections || {})
        dataFile = candidate
        return
      } catch (error) {
        // 换下一个候选位置
      }
    }
  }

  function ensureLoaded() {
    if (!loading) {
      loading = load().catch((error) => {
        loading = null
        throw error
      })
    }
    return loading
  }

  async function save() {
    const text = JSON.stringify(state, null, 2)
    let lastError = null
    for (const candidate of [dataFile, ...DATA_CANDIDATES]) {
      try {
        await writeText(candidate, text)
        dataFile = candidate
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError || new Error('无法写入数据文件')
  }

  function normalizeItem(input) {
    const now = nowIso()
    const level = input.level === 'week' || input.level === 'month' ? input.level : 'day'
    const status = input.status || 'todo'
    const day = input.date || todayKey()
    const parentIds = Array.isArray(input.parentIds)
      ? input.parentIds.filter(Boolean).map(String)
      : input.parentId
        ? [String(input.parentId)]
        : []
    return {
      id: input.id || newId(),
      level,
      date: level === 'day' ? day : null,
      periodKey:
        level === 'day'
          ? null
          : input.periodKey || (level === 'week' ? isoWeekKey(day) : day.slice(0, 7)),
      title: String(input.title || '').trim(),
      status,
      priority: input.priority || 'mid',
      project: input.project ? String(input.project).trim() : '',
      goalId: input.goalId || null,
      parentId: parentIds[0] || null,
      parentIds,
      estimateH: numberOrNull(input.estimateH),
      spentH: numberOrNull(input.spentH),
      dueDate: input.dueDate || null,
      finishedAt: input.finishedAt || null,
      note: input.note ? String(input.note) : '',
      link: input.link || null,
      origin: input.origin || 'manual',
      completedAt: status === 'done' ? input.completedAt || now : null,
      createdAt: input.createdAt || now,
      updatedAt: now,
    }
  }

  function saveItem(patch) {
    const index = patch.id ? state.items.findIndex((item) => item.id === patch.id) : -1
    const base = index >= 0 ? state.items[index] : {}
    const item = normalizeItem({ ...base, ...patch })
    if (!item.title) throw new Error('标题不能为空')
    if (index >= 0) state.items[index] = item
    else state.items.push(item)
    return item
  }

  function removeItem(id) {
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0) return false
    state.items.splice(index, 1)
    state.items = state.items.filter((item) => item.parentId !== id)
    return true
  }

  function rollover(dateKey) {
    const target = addDays(dateKey || todayKey(), 1)
    let moved = 0
    for (const item of state.items) {
      if (item.level !== 'day' || item.date !== dateKey) continue
      if (item.status === 'done' || item.status === 'dropped') continue
      item.date = target
      item.origin = 'rollover'
      item.updatedAt = nowIso()
      moved += 1
    }
    return { moved, target }
  }

  function saveGoal(patch) {
    const now = nowIso()
    const index = patch.id ? state.goals.findIndex((goal) => goal.id === patch.id) : -1
    const base = index >= 0 ? state.goals[index] : {}
    const merged = { ...base, ...patch }
    const goal = {
      id: merged.id || newId(),
      periodType: merged.periodType === 'quarter' ? 'quarter' : 'month',
      periodKey: merged.periodKey || todayKey().slice(0, 7),
      title: String(merged.title || '').trim(),
      target: numberOrNull(merged.target),
      current: numberOrNull(merged.current),
      unit: merged.unit ? String(merged.unit) : '',
      weight: numberOrNull(merged.weight) ?? 1,
      updatedAt: now,
    }
    if (!goal.title) throw new Error('目标不能为空')
    if (index >= 0) state.goals[index] = goal
    else state.goals.push(goal)
    return goal
  }

  function removeGoal(id) {
    const index = state.goals.findIndex((goal) => goal.id === id)
    if (index < 0) return false
    state.goals.splice(index, 1)
    return true
  }

  function itemsOfPeriod(kind, key) {
    return state.items.filter((item) => {
      if (item.level !== 'day') return false
      if (kind === 'daily') return item.date === key
      if (kind === 'weekly') return isoWeekKey(item.date) === key
      if (kind === 'monthly') return item.date.slice(0, 7) === key
      return false
    })
  }

  function goalsOfPeriod(kind, key) {
    const monthKey =
      kind === 'monthly' ? key : kind === 'weekly' ? mondayOfWeekKey(key).slice(0, 7) : key.slice(0, 7)
    return state.goals.filter((goal) => goal.periodKey === monthKey)
  }

  function parentsOf(item) {
    if (Array.isArray(item.parentIds) && item.parentIds.length > 0) return item.parentIds
    return item.parentId ? [item.parentId] : []
  }

  function planLabelOf(item) {
    const parents = parentsOf(item)
    if (parents.length === 0) return '计划外'
    const titles = parents.map((id) => {
      const parent = state.items.find((entry) => entry.id === id)
      return parent ? parent.title : '已删除的计划条目'
    })
    return titles.join(' / ') || '计划外'
  }

  function groupByPlan(items) {
    const groups = new Map()
    for (const item of items) {
      const key = planLabelOf(item)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    return groups
  }

  function bulletHours(items) {
    const lines = []
    for (const [plan, list] of groupByPlan(items)) {
      lines.push('　▸ ' + plan)
      for (const item of list) {
        const hours = item.spentH ?? item.estimateH
        lines.push('　　· ' + item.title + (hours === null ? '' : '　' + hours + 'H'))
      }
    }
    return lines.join('\n')
  }

  function statsLine(kind, days) {
    const planned = days.filter((item) => item.parentId)
    const done = days.filter((item) => item.status === 'done')
    const donePlanned = done.filter((item) => item.parentId)
    const offPlan = done.filter((item) => !item.parentId)
    const ratios = done.filter((item) => item.estimateH && item.spentH).map((item) => item.spentH / item.estimateH)
    const rate = planned.length ? Math.round((donePlanned.length / planned.length) * 100) + '%' : '—'
    const offPlanRate = done.length ? Math.round((offPlan.length / done.length) * 100) + '%' : '—'
    const deviation = median(ratios) === null ? '—' : round1(median(ratios)) + '×'
    return '计划达成 ' + donePlanned.length + '/' + planned.length + '（' + rate + '）｜计划外 ' + offPlanRate + '｜估时偏差 ' + deviation
  }

  function buildReport(kind, key) {
    const days = itemsOfPeriod(kind, key)
    const done = days.filter((item) => item.status === 'done')
    const left = days.filter((item) => item.status !== 'done' && item.status !== 'dropped')
    const hours = round1(done.reduce((sum, item) => sum + (item.spentH ?? item.estimateH ?? 0), 0))
    const narrative = (state.narratives && state.narratives[kind + ':' + key]) || ''
    const leftAuto = left.map((item) => '　· ' + item.title).join('\n') || '　-'
    const leftOverride = (state.narratives && state.narratives[kind + ':' + key + ':left']) || ''

    const sections = {
      done: bulletHours(done) || '　-',
      hours: String(hours),
      left: leftOverride.trim() ? leftOverride : leftAuto,
      goals: narrative.trim() ? narrative : '　-',
      stats: statsLine(kind, days),
    }

    let title = ''
    let body = ''
    if (kind === 'daily') {
      title = '【日报】' + key
      body = [
        title,
        '',
        '今日完成工作：',
        sections.done,
        '',
        '所用工时：' + sections.hours,
        '',
        '未完成工作和明天计划：',
        sections.left,
      ].join('\n')
    } else if (kind === 'weekly') {
      const monday = mondayOfWeekKey(key)
      title = '【周报】' + key + '（' + shortDate(monday) + '–' + shortDate(addDays(monday, 6)) + '）'
      body = [
        title,
        '',
        '一、目标推进',
        sections.goals,
        '',
        '二、本周完成 ' + done.length + '/' + days.length,
        sections.done,
        '',
        '三、未完成 / 下周计划',
        sections.left,
        '',
        '〔统计〕' + sections.stats,
      ].join('\n')
    } else {
      title = '【月报】' + key
      body = [
        title,
        '',
        '一、目标达成',
        sections.goals,
        '',
        '二、本月完成 ' + done.length + '/' + days.length,
        sections.done,
        '',
        '三、未完成 / 下月计划',
        sections.left,
        '',
        '〔统计〕' + sections.stats,
      ].join('\n')
    }

    const fields = TEMPLATE_FIELDS.map((name) => {
      if (name === '今日完成工作') return { name, content: sections.done }
      if (name === '所用工时') return { name, content: sections.hours }
      if (name === '未完成工作和明天计划') return { name, content: sections.left }
      return {
        name,
        content: ((state.settings.dingtalk && state.settings.dingtalk.recipients) || [])
          .map((person) => person.name)
          .join('、'),
      }
    })

    return {
      kind,
      key,
      title,
      sections,
      markdown: body,
      fields,
      overrides: { left: Boolean(leftOverride.trim()), goals: Boolean(narrative.trim()) },
    }
  }

  function exportRootPath() {
    const configured = state.settings && state.settings.exportRoot
    if (configured && String(configured).trim()) return path.normalize(String(configured).trim())
    return path.join(root(), DEFAULT_EXPORT_DIR)
  }

  function reportFileName(kind, key) {
    if (kind === 'daily') return path.join(key.slice(0, 4), key.slice(5, 7), key + '.daily.md')
    if (kind === 'weekly') return path.join(mondayOfWeekKey(key).slice(0, 4), key, key + '.weekly.md')
    return path.join(key.slice(0, 4), key.slice(5, 7), key + '.monthly.md')
  }

  async function exportReport(kind, key) {
    const report = buildReport(kind, key)
    const base = exportRootPath()
    const target = path.join(base, reportFileName(kind, key))
    await writeText(target, report.markdown)
    return { path: target, markdown: report.markdown }
  }

  // ---------------- GitLab ----------------

  function normalizeBaseUrl(input) {
    let base = String(input || '').trim()
    if (!base) throw new Error('GitLab 地址不能为空')
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base
    base = base.replace(/\/+$/, '')
    if (!/\/api\/v4$/i.test(base)) base += '/api/v4'
    return base
  }

  function normalizeToken(value) {
    const raw = String(value || '')
    const cleaned = raw.replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
    return { token: cleaned, changed: cleaned !== raw, length: cleaned.length }
  }

  function gitlabConnection(override) {
    const stored = (state.connections && state.connections.gitlab) || null
    const baseUrl = (override && override.baseUrl) || (stored && stored.baseUrl)
    const rawToken = (override && override.token) || (stored && stored.token)
    if (!baseUrl || !rawToken) throw new Error('GitLab 尚未配置，请先在插件配置页填写地址与令牌')
    const cleaned = normalizeToken(rawToken)
    if (!cleaned.token) throw new Error('令牌为空')
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      token: cleaned.token,
      tokenChanged: cleaned.changed,
      authMode: (stored && stored.authMode) || 'private',
    }
  }

  async function gitlabRaw(conn, pathname, init, mode) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const headers = Object.assign(
      { accept: 'application/json', 'user-agent': 'dsh-workbench/0.1' },
      init && init.headers ? init.headers : {},
      mode === 'bearer' ? { authorization: 'Bearer ' + conn.token } : { 'PRIVATE-TOKEN': conn.token },
    )
    try {
      const response = await fetch(conn.baseUrl + pathname, { ...init, headers, signal: controller.signal })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch (error) {
        data = null
      }
      return { ok: response.ok, status: response.status, data, text }
    } finally {
      clearTimeout(timer)
    }
  }

  async function gitlabRequest(conn, pathname, init) {
    let result
    try {
      result = await gitlabRaw(conn, pathname, init, conn.authMode)
      if (result.status === 401) {
        const alternate = conn.authMode === 'private' ? 'bearer' : 'private'
        const retry = await gitlabRaw(conn, pathname, init, alternate)
        if (retry.ok) {
          conn.authMode = alternate
          result = retry
        }
      }
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('GitLab 请求超时（15 秒）：检查地址与网络')
      throw new Error('GitLab 请求失败：' + String((error && error.message) || error))
    }
    if (!result.ok) {
      const raw = result.data && (result.data.message || result.data.error)
      const detail = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : String(result.text || '').slice(0, 200)
      if (result.status === 401) {
        throw new Error(
          'GitLab 401：令牌被拒绝（' + detail + '）。已尝试 PRIVATE-TOKEN 与 Bearer 两种方式；' +
            '常见原因：令牌含空白字符、复制成了令牌名称、令牌已吊销、或这个令牌属于另一个实例。',
        )
      }
      if (result.status === 403) throw new Error('GitLab 403：令牌权限不足（' + detail + '）')
      if (result.status === 404) throw new Error('GitLab 404：地址或项目不存在（' + detail + '）')
      throw new Error('GitLab ' + result.status + '：' + detail)
    }
    return result.data
  }

  async function gitlabTest(input) {
    const conn = gitlabConnection({ baseUrl: input.baseUrl, token: input.token })
    const user = await gitlabRequest(conn, '/user')
    const projects = await gitlabRequest(conn, '/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true')
    const username = String((user && user.username) || '')
    return {
      baseUrl: conn.baseUrl,
      authMode: conn.authMode,
      tokenInfo: { length: conn.token.length, changed: conn.tokenChanged },
      user: { username, name: (user && user.name) || '' },
      tokenType: /^project_\d+_bot/.test(username) ? 'project' : 'personal',
      projects: (projects || []).map((project) => ({
        id: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        webUrl: project.web_url,
      })),
    }
  }

  async function gitlabMilestones(projectId) {
    const conn = gitlabConnection()
    const list = await gitlabRequest(
      conn,
      '/projects/' + encodeURIComponent(projectId) + '/milestones?state=active&per_page=50',
    )
    return (list || []).map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      dueDate: milestone.due_date,
      webUrl: milestone.web_url,
    }))
  }

  async function gitlabIssues(projectId, milestoneId) {
    const conn = gitlabConnection()
    let path = '/projects/' + encodeURIComponent(projectId) + '/issues?state=opened&per_page=50&order_by=updated_at'
    if (milestoneId) path += '&milestone=' + encodeURIComponent(milestoneId)
    const list = await gitlabRequest(conn, path)
    return (list || []).map((issue) => ({
      iid: issue.iid,
      title: issue.title,
      webUrl: issue.web_url,
      milestone: issue.milestone ? issue.milestone.title : null,
    }))
  }

  async function gitlabMilestonesAll() {
    const stored = state.connections && state.connections.gitlab
    if (!stored) throw new Error('GitLab 尚未配置')
    const ids = stored.projectIds || []
    if (ids.length === 0) throw new Error('还没有勾选项目')
    const milestones = []
    const failures = []
    for (const projectId of ids) {
      try {
        const list = await gitlabMilestones(projectId)
        for (const milestone of list) milestones.push({ ...milestone, projectId })
      } catch (error) {
        failures.push({ projectId, error: String((error && error.message) || error) })
      }
    }
    if (milestones.length === 0 && failures.length > 0) {
      throw new Error('读取里程碑失败：' + failures[0].error)
    }
    return { milestones, failures }
  }

  async function gitlabCurrentUserId() {
    const stored = state.connections && state.connections.gitlab
    if (!stored) throw new Error('GitLab 尚未配置')
    if (stored.userId) return stored.userId
    const conn = gitlabConnection()
    const user = await gitlabRequest(conn, '/user')
    stored.userId = user.id
    await save()
    return user.id
  }

  async function gitlabCreateIssue(input) {
    const conn = gitlabConnection()
    const payload = {
      title: String(input.title || '').trim(),
      description: input.description ? String(input.description) : undefined,
      milestone_id: input.milestoneId ? Number(input.milestoneId) : undefined,
      due_date: input.dueDate || undefined,
      labels: input.labels || undefined,
      assignee_ids: Array.isArray(input.assigneeIds) && input.assigneeIds.length ? input.assigneeIds : undefined,
    }
    if (!payload.title) throw new Error('议题标题不能为空')
    const path = '/projects/' + encodeURIComponent(input.projectId) + '/issues'
    const attempt = (body) =>
      gitlabRequest(conn, path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const wantsTask = input.issueType === 'task'
    let issue
    let fallback = false
    try {
      issue = await attempt(wantsTask ? { ...payload, issue_type: 'task' } : payload)
    } catch (error) {
      const message = String((error && error.message) || error)
      if (wantsTask && /GitLab (400|422)/.test(message)) {
        issue = await attempt(payload)
        fallback = true
      } else {
        throw error
      }
    }
    return {
      iid: issue.iid,
      title: issue.title,
      webUrl: issue.web_url,
      type: wantsTask && !fallback ? 'task' : 'issue',
      fallback,
    }
  }

  async function gitlabUpdateIssue(input) {
    const conn = gitlabConnection()
    const payload = {
      title: String(input.title || '').trim(),
      description: String(input.description || ''),
      milestone_id: input.milestoneId ? Number(input.milestoneId) : undefined,
      due_date: input.dueDate || undefined,
      assignee_ids: Array.isArray(input.assigneeIds) && input.assigneeIds.length ? input.assigneeIds : undefined,
      state_event: input.stateEvent || undefined,
    }
    const issue = await gitlabRequest(
      conn,
      '/projects/' + encodeURIComponent(input.projectId) + '/issues/' + encodeURIComponent(input.iid),
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    )
    return { iid: issue.iid, title: issue.title, webUrl: issue.web_url, state: issue.state }
  }

  async function gitlabTimeCall(projectId, iid, action, duration) {
    const conn = gitlabConnection()
    const suffix = duration === undefined ? '' : '?duration=' + encodeURIComponent(duration)
    return gitlabRequest(
      conn,
      '/projects/' + encodeURIComponent(projectId) + '/issues/' + encodeURIComponent(iid) + '/' + action + suffix,
      { method: 'POST' },
    )
  }

  async function gitlabSync(input) {
    const item = state.items.find((entry) => entry.id === input.itemId)
    if (!item) throw new Error('任务不存在')
    if (item.level !== 'day') throw new Error('只有日任务可以同步到 GitLab')
    const projectId = Number(input.projectId || (item.link && item.link.projectId))
    if (!projectId) throw new Error('先选择 GitLab 项目')
    const milestoneId = input.milestoneId || (item.link && item.link.milestoneId) || null
    const issueType = input.issueType || (item.link && item.link.issueType) || 'task'

    const wasLinked = Boolean(item.link && item.link.issueIid)
    const previousNote = (item.link && item.link.lastNoteBody) || ''
    const assigneeIds = [await gitlabCurrentUserId()]

    let iid = item.link && item.link.issueIid ? String(item.link.issueIid) : null
    let created = false
    let recreated = false
    let fallback = false
    let webUrl = item.link && item.link.webUrl ? item.link.webUrl : ''
    const dueDate = item.date || item.dueDate || null
    const stateEvent = item.status === 'done' ? 'close' : 'reopen'

    if (iid) {
      try {
        const updated = await gitlabUpdateIssue({
          projectId,
          iid,
          title: item.title,
          description: item.note,
          milestoneId,
          dueDate,
          stateEvent,
          assigneeIds,
        })
        webUrl = updated.webUrl || webUrl
      } catch (error) {
        if (!/GitLab 404/.test(String((error && error.message) || error))) throw error
        if (!input.allowRecreate) {
          const missing = new Error(
            'GitLab 上这条任务已不存在（#' + iid + '，可能被删除了）。请再点一次「保存并同步 GitLab」确认重新创建。',
          )
          missing.code = 'ISSUE_MISSING'
          throw missing
        }
        // 用户确认后：重新创建并接管链接
        const made = await gitlabCreateIssue({
          projectId,
          title: item.title,
          description: item.note,
          milestoneId,
          issueType,
          dueDate,
          assigneeIds,
        })
        iid = String(made.iid)
        webUrl = made.webUrl
        created = true
        recreated = true
      }
    } else {
      const made = await gitlabCreateIssue({
        projectId,
        title: item.title,
        description: item.note,
        milestoneId,
        issueType,
        dueDate,
        assigneeIds,
      })
      iid = String(made.iid)
      webUrl = made.webUrl
      created = true
      fallback = made.fallback
    }

    const warnings = []
    if (item.estimateH !== null && item.estimateH !== undefined) {
      try {
        await gitlabTimeCall(projectId, iid, 'time_estimate', item.estimateH + 'h')
      } catch (error) {
        warnings.push('预估工时同步失败：' + String((error && error.message) || error))
      }
    }
    if (item.spentH !== null && item.spentH !== undefined && item.spentH > 0) {
      try {
        await gitlabTimeCall(projectId, iid, 'reset_spent_time')
        await gitlabTimeCall(projectId, iid, 'add_spent_time', item.spentH + 'h')
      } catch (error) {
        warnings.push('花费工时同步失败：' + String((error && error.message) || error))
      }
    }

    let noteState = previousNote
    let notePushed = false
    const noteBody = String(item.note || '').trim()
    if (noteBody && (created || noteBody !== previousNote)) {
      try {
        await gitlabAddNote(projectId, iid, noteBody)
        noteState = noteBody
        notePushed = true
      } catch (error) {
        warnings.push('评论同步失败：' + String((error && error.message) || error))
      }
    }

    item.link = {
      projectId,
      issueIid: iid,
      issueType,
      milestoneId: milestoneId ? Number(milestoneId) : null,
      webUrl,
      lastNoteBody: noteState,
      lastSyncAt: nowIso(),
    }
    item.updatedAt = nowIso()
    await save()
    const review = { item, created, recreated, fallback, warnings, webUrl, notePushed }
    return review
  }

  async function gitlabUpload(projectId, name, base64) {
    const conn = gitlabConnection()
    if (!projectId) throw new Error('先选择 GitLab 项目再上传附件')
    const buffer = Buffer.from(String(base64 || ''), 'base64')
    if (buffer.length === 0) throw new Error('文件为空')
    if (buffer.length > 10 * 1024 * 1024) throw new Error('附件不能超过 10MB')
    const form = new FormData()
    form.append('file', new Blob([buffer]), String(name || 'file'))
    const response = await fetch(conn.baseUrl + '/projects/' + encodeURIComponent(projectId) + '/uploads', {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': conn.token },
      body: form,
    })
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (error) {
      data = null
    }
    if (!response.ok) {
      throw new Error('上传失败：' + (data && data.message ? data.message : 'HTTP ' + response.status))
    }
    return { markdown: data.markdown, url: data.url, alt: data.alt }
  }

  async function gitlabAddNote(projectId, iid, body) {
    const conn = gitlabConnection()
    const note = await gitlabRequest(
      conn,
      '/projects/' + encodeURIComponent(projectId) + '/issues/' + encodeURIComponent(iid) + '/notes',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) },
    )
    return { id: note.id, createdAt: note.created_at }
  }

  async function gitlabPull(itemId, apply) {
    const item = state.items.find((entry) => entry.id === itemId)
    if (!item) throw new Error('任务不存在')
    if (!item.link || !item.link.issueIid) throw new Error('这条任务还没关联 GitLab')
    const conn = gitlabConnection()
    const base = '/projects/' + encodeURIComponent(item.link.projectId) + '/issues/' + encodeURIComponent(item.link.issueIid)
    const issue = await gitlabRequest(conn, base)
    let stats = null
    try {
      stats = await gitlabRequest(conn, base + '/time_stats')
    } catch (error) {
      stats = null
    }
    let applied = false
    if (apply) {
      if (issue.state === 'closed' && item.status !== 'done') {
        item.status = 'done'
        item.completedAt = issue.closed_at || nowIso()
        applied = true
      } else if (issue.state === 'opened' && item.status === 'done') {
        item.status = 'todo'
        item.completedAt = null
        applied = true
      }
      if (applied) {
        item.updatedAt = nowIso()
        await save()
      }
    }
    return {
      applied,
      issue: {
        state: issue.state,
        title: issue.title,
        milestone: issue.milestone ? issue.milestone.title : null,
        webUrl: issue.web_url,
        updatedAt: issue.updated_at,
      },
      timeStats: stats
        ? { estimate: stats.time_estimate, spent: stats.total_time_spent, human: stats.human_total_time_spent }
        : null,
    }
  }

  function saveGitlab(input) {
    const previous = (state.connections && state.connections.gitlab) || null
    const incoming = input.token ? normalizeToken(input.token).token : ''
    const token = incoming || (previous && previous.token)
    if (!token) throw new Error('需要填写访问令牌')
    const baseUrl = normalizeBaseUrl(input.baseUrl || (previous && previous.baseUrl))
    state.connections.gitlab = {
      baseUrl,
      token,
      authMode: input.authMode || (previous && previous.authMode) || 'private',
      projectIds: Array.isArray(input.projectIds)
        ? input.projectIds.map(Number).filter((id) => Number.isFinite(id))
        : (previous && previous.projectIds) || [],
      projects: Array.isArray(input.projects) ? input.projects : (previous && previous.projects) || [],
    }
    return state.connections.gitlab
  }

  function linkIssue(input) {
    const item = state.items.find((entry) => entry.id === input.id)
    if (!item) throw new Error('任务不存在')
    item.link = input.issueIid
      ? {
          projectId: input.projectId ? Number(input.projectId) : null,
          issueIid: String(input.issueIid),
          issueTitle: input.issueTitle || '',
        }
      : null
    item.updatedAt = nowIso()
    return item
  }

  function maskedConnections() {
    const gitlab = state.connections && state.connections.gitlab
    if (!gitlab) return { gitlab: null }
    return {
      gitlab: {
        baseUrl: gitlab.baseUrl,
        projectIds: gitlab.projectIds || [],
        projects: gitlab.projects || [],
        hasToken: Boolean(gitlab.token),
        tokenHint: gitlab.token ? String(gitlab.token).slice(-4) : '',
      },
    }
  }

  // ---------------- 钉钉（dws 命令行） ----------------

  let launcherCache = null

  async function dwsLauncher() {
    if (launcherCache) return launcherCache
    const configured = state.settings && state.settings.dwsPath
    if (configured) {
      launcherCache = { kind: 'shell', command: configured }
      return launcherCache
    }
    const base = 'C:\\Users\\1\\.workbuddy\\binaries\\node'
    try {
      const versions = await readdir(path.join(base, 'versions'))
      const sorted = versions
        .filter((entry) => /^\d+\./.test(entry))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      for (let index = sorted.length - 1; index >= 0; index -= 1) {
        const nodeExe = path.join(base, 'versions', sorted[index], 'node.exe')
        const dwsJs = path.join(base, 'cli-connector-packages', 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js')
        if (existsSync(nodeExe) && existsSync(dwsJs)) {
          launcherCache = { kind: 'node', nodeExe, dwsJs }
          return launcherCache
        }
      }
    } catch (error) {
      // 退回 PATH 上的 dws
    }
    launcherCache = { kind: 'shell', command: 'dws' }
    return launcherCache
  }

  async function runDws(args, options = {}) {
    const launcher = await dwsLauncher()
    const cwd = options.cwd || path.join(root(), 'worklog')
    await mkdir(cwd, { recursive: true })
    return new Promise((resolve, reject) => {
      const execOptions = {
        cwd,
        timeout: options.timeout || 60000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      }
      const onDone = (error, stdout, stderr) => {
        const text = String(stdout || '').trim()
        if (text) {
          try {
            resolve(JSON.parse(text))
            return
          } catch (parseError) {
            reject(new Error('dws 返回的不是 JSON：' + text.slice(0, 300)))
            return
          }
        }
        const detail = String(stderr || (error && error.message) || '').trim()
        reject(new Error('dws 调用失败：' + (detail.slice(0, 400) || '无输出')))
      }
      if (launcher.kind === 'node') {
        execFile(launcher.nodeExe, [launcher.dwsJs, ...args], execOptions, onDone)
      } else {
        execFile(launcher.command, args, { ...execOptions, shell: true }, onDone)
      }
    })
  }

  function dingtalkSettings() {
    return state.settings.dingtalk || {}
  }

  function buildContents(report, risksText) {
    const ding = dingtalkSettings()
    const fields = ding.fields || []
    const mapping = ding.mapping || {}
    const byField = {
      [mapping.done]: report.sections.done,
      [mapping.hours]: report.sections.hours,
      [mapping.left]: report.sections.left,
      [mapping.risks]: risksText ? String(risksText) : '-',
    }
    const contents = []
    for (const field of fields) {
      const type = Number(field.type)
      if (type === 3 || type === 5 || type === 8 || type === 9) continue
      const content = byField[field.name]
      if (content === undefined) continue
      contents.push({
        key: field.name,
        sort: String(field.sort),
        type: String(field.type),
        content: String(content),
        contentType: type === 1 ? 'markdown' : 'origin',
      })
    }
    if (contents.length === 0) throw new Error('字段映射为空：请先在插件配置页选择日志模板')
    return contents
  }

  async function submitReport(body, dryRun) {
    const ding = dingtalkSettings()
    if (!ding.templateId) throw new Error('尚未选择日志模板，请先在插件配置页选择')
    const recipients = Array.isArray(body.toUserIds) ? body.toUserIds.filter(Boolean) : []
    if (recipients.length === 0) throw new Error('必须至少选择一个日志接收人，否则日志对任何人都不可见')
    const kind = body.kind || 'daily'
    const key = body.key || todayKey()
    const report = buildReport(kind, key)
    const contents = buildContents(report, body.risks)
    const dir = path.join(root(), 'worklog', '.tmp')
    await mkdir(dir, { recursive: true })
    const fileName = 'contents-' + Date.now() + '.json'
    await writeFile(path.join(dir, fileName), JSON.stringify(contents), 'utf8')
    const args = [
      'report',
      'entry',
      'submit',
      '--template-id',
      ding.templateId,
      '--contents-file',
      fileName,
      '--to-user-ids',
      recipients.join(','),
      '--format',
      'json',
    ]
    args.push(dryRun ? '--dry-run' : '--yes')
    let result
    try {
      result = await runDws(args, { cwd: dir })
    } finally {
      unlink(path.join(dir, fileName)).catch(() => {})
    }
    if (!dryRun) {
      const now = nowIso()
      state.reports.push({
        id: newId(),
        kind,
        periodKey: key,
        status: 'submitted',
        generatedAt: now,
        submittedAt: now,
        markdown: report.markdown,
        delivery: {
          templateId: ding.templateId,
          templateName: ding.templateName,
          recipients,
          reportId: result.reportId || (result.result && result.result.report_id) || '',
          link:
            result.dingtalkOpenMarkdownLink ||
            result.dingtalkOpenUrl ||
            (result.result && result.result.url) ||
            '',
          raw: result,
        },
      })
      state.runs.push({
        id: newId(),
        kind: 'submit',
        startedAt: now,
        finishedAt: now,
        ok: true,
        payload: { kind, key, recipients },
      })
      await save()
    }
    return { report, contents, result, dryRun: Boolean(dryRun) }
  }

  // ---------------- 定时草稿 ----------------

  async function tick() {
    try {
      await ensureLoaded()
      const schedule = (state.settings && state.settings.schedule) || {}
      if (!schedule.enabled) return
      const now = shanghaiNow()
      const isFriday = now.weekday === 'Fri'
      const target = isFriday ? schedule.fridayTime || '18:00' : schedule.weekdayTime || '18:00'
      if (now.time < target) return
      if (!state.scheduleState) state.scheduleState = { dailyDate: '', weeklyKey: '' }
      let changed = false
      if (state.scheduleState.dailyDate !== now.date) {
        const report = buildReport('daily', now.date)
        state.reports.push({
          id: newId(),
          kind: 'daily',
          periodKey: now.date,
          status: 'draft',
          ack: false,
          generatedAt: nowIso(),
          markdown: report.markdown,
        })
        state.scheduleState.dailyDate = now.date
        changed = true
      }
      if (isFriday && schedule.weeklyOnFriday) {
        const weekKey = isoWeekKey(now.date)
        if (state.scheduleState.weeklyKey !== weekKey) {
          const report = buildReport('weekly', weekKey)
          state.reports.push({
            id: newId(),
            kind: 'weekly',
            periodKey: weekKey,
            status: 'draft',
            ack: false,
            generatedAt: nowIso(),
            markdown: report.markdown,
          })
          state.scheduleState.weeklyKey = weekKey
          changed = true
        }
      }
      if (changed) await save()
    } catch (error) {
      // 定时任务失败不影响主流程
    }
  }

  function reportIndex() {
    const map = new Map()
    for (const report of state.reports || []) {
      const key = report.kind + ':' + report.periodKey
      const rank = report.status === 'submitted' ? 2 : 1
      const existing = map.get(key)
      if (!existing || rank >= existing.rank) {
        map.set(key, {
          rank,
          id: report.id,
          kind: report.kind,
          periodKey: report.periodKey,
          status: report.status,
          generatedAt: report.generatedAt,
          submittedAt: report.submittedAt || null,
          link: (report.delivery && report.delivery.link) || '',
        })
      }
    }
    return Array.from(map.values())
      .sort((left, right) => (left.periodKey < right.periodKey ? 1 : left.periodKey > right.periodKey ? -1 : 0))
      .slice(0, 60)
  }

  // ---------------- Word 导出 ----------------

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      table[index] = value >>> 0
    }
    return table
  })()

  function crc32(buffer) {
    let crc = 0xffffffff
    for (let index = 0; index < buffer.length; index += 1) {
      crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  function zipStore(entries) {
    const parts = []
    const central = []
    let offset = 0
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8')
      const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
      const crc = crc32(data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6)
      local.writeUInt16LE(0, 8)
      local.writeUInt16LE(0, 10)
      local.writeUInt16LE(0x21, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      parts.push(local, name, data)

      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0)
      record.writeUInt16LE(20, 4)
      record.writeUInt16LE(20, 6)
      record.writeUInt16LE(0x0800, 8)
      record.writeUInt16LE(0, 10)
      record.writeUInt16LE(0, 12)
      record.writeUInt16LE(0x21, 14)
      record.writeUInt32LE(crc, 16)
      record.writeUInt32LE(data.length, 20)
      record.writeUInt32LE(data.length, 24)
      record.writeUInt16LE(name.length, 28)
      record.writeUInt16LE(0, 30)
      record.writeUInt16LE(0, 32)
      record.writeUInt16LE(0, 34)
      record.writeUInt16LE(0, 36)
      record.writeUInt32LE(0, 38)
      record.writeUInt32LE(offset, 42)
      central.push(record, name)
      offset += local.length + name.length + data.length
    }
    const centralBuf = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(centralBuf.length, 12)
    end.writeUInt32LE(offset, 16)
    end.writeUInt16LE(0, 20)
    return Buffer.concat(parts.concat([centralBuf, end]))
  }

  function xmlEscape(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function docParagraph(text, options = {}) {
    const size = options.size || 21
    const bold = options.bold ? '<w:b/>' : ''
    const color = options.color ? '<w:color w:val="' + options.color + '"/>' : ''
    const spacing = options.after === undefined ? 60 : options.after
    const indent = options.indent ? '<w:ind w:left="' + options.indent + '"/>' : ''
    const tabs = options.tab ? '<w:tabs><w:tab w:val="right" w:pos="8300"/></w:tabs>' : ''
    const textXml = xmlEscape(text).replace(/\t/g, '</w:t><w:tab/><w:t xml:space="preserve">')
    return (
      '<w:p><w:pPr>' +
      tabs +
      indent +
      '<w:spacing w:before="0" w:after="' +
      spacing +
      '" w:line="300" w:lineRule="auto"/>' +
      '</w:pPr>' +
      '<w:r><w:rPr>' +
      bold +
      color +
      '<w:sz w:val="' +
      size +
      '"/><w:szCs w:val="' +
      size +
      '"/></w:rPr>' +
      '<w:t xml:space="preserve">' +
      textXml +
      '</w:t></w:r></w:p>'
    )
  }

  function buildDocx(kind, key) {
    const report = buildReport(kind, key)
    const days = itemsOfPeriod(kind, key)
    const done = days.filter((item) => item.status === 'done')
    const open = days.filter((item) => item.status !== 'done' && item.status !== 'dropped')

    const groups = new Map()
    for (const item of done) {
      const label = planLabelOf(item)
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label).push(item)
    }

    const title = kind === 'daily' ? '工作日报' : kind === 'weekly' ? '工作周报' : '工作月报'
    const meta = key + '　完成 ' + done.length + '/' + days.length + '　工时 ' + report.sections.hours + 'h'
    const body = []
    body.push(docParagraph(title, { size: 36, bold: true, after: 80 }))
    body.push(docParagraph(meta, { size: 18, color: '6B6B74', after: 200 }))

    if (kind !== 'daily') {
      body.push(docParagraph('一、目标推进 / 小结', { size: 24, bold: true, after: 80 }))
      for (const line of String(report.sections.goals || '').split('\n')) {
        body.push(docParagraph(line, { size: 21, after: 40 }))
      }
      body.push(docParagraph('', { size: 10, after: 60 }))
    }

    const doneTitle = kind === 'daily' ? (kind !== 'daily' ? '二、今日完成' : '一、今日完成') : '二、本期完成'
    body.push(docParagraph(kind === 'daily' ? '一、今日完成工作' : '二、本期完成工作', { size: 24, bold: true, after: 80 }))
    if (done.length === 0) {
      body.push(docParagraph('　（无）', { size: 21, color: '6B6B74', after: 40 }))
    }
    for (const entry of groups.entries()) {
      body.push(docParagraph(entry[0], { size: 18, color: '6B6B74', after: 30 }))
      for (const item of entry[1]) {
        const hours = item.spentH ?? item.estimateH
        body.push(
          docParagraph('· ' + item.title + (hours === null ? '' : '\t' + hours + 'h'), {
            size: 21,
            indent: 360,
            tab: true,
            after: 30,
          }),
        )
      }
    }

    body.push(docParagraph('', { size: 10, after: 60 }))
    body.push(docParagraph(kind === 'daily' ? '二、所用工时' : '三、所用工时', { size: 24, bold: true, after: 80 }))
    body.push(docParagraph(report.sections.hours + ' h', { size: 32, bold: true, after: 160 }))

    body.push(
      docParagraph(kind === 'daily' ? '三、未完成工作和明天计划' : '四、未完成 / 下一步计划', {
        size: 24,
        bold: true,
        after: 80,
      }),
    )
    const leftLines = String(report.sections.left || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (leftLines.length === 0) {
      body.push(docParagraph('　（无）', { size: 21, color: '6B6B74', after: 40 }))
    }
    for (const line of leftLines) {
      body.push(docParagraph(line.replace(/^·\s*/, '· '), { size: 21, indent: 360, after: 30 }))
    }

    body.push(docParagraph('', { size: 10, after: 60 }))
    body.push(docParagraph(report.sections.stats, { size: 18, color: '6B6B74', after: 40 }))

    const sectPr =
      '<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>' +
      '</w:sectPr>'

    const document =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' +
      body.join('') +
      sectPr +
      '</w:body></w:document>'

    const styles =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="微软雅黑" w:cs="Calibri"/>' +
      '<w:sz w:val="21"/><w:szCs w:val="21"/>' +
      '</w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults></w:styles>'

    const footer =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
      '<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>' +
      '</w:p></w:ftr>'

    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '</Types>'

    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'

    const docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '</Relationships>'

    return zipStore([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: docRels },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/footer1.xml', data: footer },
    ])
  }

  async function exportWord(kind, key) {
    const buffer = buildDocx(kind, key)
    const fileName = key + '.' + kind + '.docx'
    const base = exportRootPath()
    const target = path.join(base, reportFileName(kind, key).replace(/[^\\/]+$/, fileName))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, buffer)
    return { path: target }
  }

  function snapshot() {
    return {
      today: todayKey(),
      timeZone: TIME_ZONE,
      items: state.items,
      projects: state.projects,
      goals: state.goals,
      settings: state.settings,
      narratives: state.narratives || {},
      reportIndex: reportIndex(),
      drafts: (state.reports || [])
        .filter((report) => report.status === 'draft' && !report.ack)
        .map((report) => ({
          id: report.id,
          kind: report.kind,
          periodKey: report.periodKey,
          generatedAt: report.generatedAt,
        })),
      connections: maskedConnections(),
      dataFile,
      templateFields: TEMPLATE_FIELDS,
    }
  }

  function send(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text) return resolve({})
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(new Error('请求体不是合法 JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  async function handle(req, res) {
    let action = ''
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (!url.pathname.startsWith(API_PREFIX)) return send(res, 404, { ok: false, error: 'not-found' })
      action = url.pathname.slice(API_PREFIX.length) || '/'
      await ensureLoaded()

      if (action === '/ping') return send(res, 200, { ok: true, dataFile, root: root() })
      if (req.method === 'GET' && action === '/state') {
        return send(res, 200, { ok: true, state: snapshot() })
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })

      const body = await readBody(req)

      if (action === '/item/save') {
        const item = saveItem(body)
        await save()
        return send(res, 200, { ok: true, item, state: snapshot() })
      }
      if (action === '/item/delete') {
        const deleted = removeItem(String(body.id || ''))
        await save()
        return send(res, 200, { ok: true, deleted, state: snapshot() })
      }
      if (action === '/item/complete') {
        const item = state.items.find((entry) => entry.id === body.id)
        if (!item) throw new Error('任务不存在')
        item.status = 'done'
        item.completedAt = nowIso()
        item.updatedAt = nowIso()
        await save()
        let sync = null
        if (item.level === 'day' && item.link && item.link.issueIid) {
          try {
            const result = await gitlabSync({ itemId: item.id })
            sync = { ok: true, warnings: result.warnings }
          } catch (error) {
            sync = { ok: false, error: String((error && error.message) || error) }
          }
        }
        return send(res, 200, { ok: true, item, sync, state: snapshot() })
      }
      if (action === '/item/rollover') {
        const result = rollover(body.date || todayKey())
        await save()
        return send(res, 200, { ok: true, ...result, state: snapshot() })
      }
      if (action === '/goal/save') {
        const goal = saveGoal(body)
        await save()
        return send(res, 200, { ok: true, goal, state: snapshot() })
      }
      if (action === '/goal/delete') {
        const deleted = removeGoal(String(body.id || ''))
        await save()
        return send(res, 200, { ok: true, deleted, state: snapshot() })
      }
      if (action === '/settings/save') {
        state.settings = normalizeSettings({ ...(state.settings || {}), ...body })
        await save()
        return send(res, 200, { ok: true, settings: state.settings, state: snapshot() })
      }
      if (action === '/dws/status') {
        const raw = await runDws(['auth', 'status', '--format', 'json'])
        return send(res, 200, {
          ok: true,
          status: {
            authenticated: Boolean(raw.authenticated),
            tokenValid: Boolean(raw.token_valid),
            corpName: raw.corp_name || '',
            userName: raw.user_name || '',
            userId: raw.user_id || '',
            corpId: raw.corp_id || '',
            expiresAt: raw.expires_at || '',
          },
        })
      }
      if (action === '/dws/templates') {
        const raw = await runDws(['report', 'template', 'list', '--format', 'json'])
        const templates = (raw.items || []).map((item) => ({
          id: item.report_template_id,
          name: item.report_template_name,
        }))
        return send(res, 200, { ok: true, templates })
      }
      if (action === '/dws/template') {
        if (!body.name) throw new Error('缺少模板名')
        const raw = await runDws(['report', 'template', 'get', '--name', String(body.name), '--format', 'json'])
        const result = (raw && raw.result) || {}
        const fields = (result.report_template_fields || []).map((field) => ({
          name: field.field_name,
          sort: field.field_sort,
          type: field.field_type,
        }))
        return send(res, 200, {
          ok: true,
          template: {
            id: result.report_template_id || '',
            name: result.report_template_name || String(body.name),
            fields,
          },
        })
      }
      if (action === '/dws/people') {
        if (!body.query) throw new Error('缺少姓名')
        const raw = await runDws([
          'aisearch',
          'person',
          '--query',
          String(body.query),
          '--dimension',
          'name',
          '--format',
          'json',
        ])
        const people = (raw.result || [])
          .map((candidate) => {
            const refs = (candidate._searchEvidence && candidate._searchEvidence.identityRefs) || []
            const hit = refs.find((ref) => ref.domain === 'contact.userId')
            return { userId: hit ? hit.value : '', name: candidate.author || candidate.actor || '' }
          })
          .filter((person) => person.userId)
        return send(res, 200, { ok: true, people })
      }
      if (action === '/dws/config') {
        state.settings = normalizeSettings({
          ...(state.settings || {}),
          dingtalk: { ...(state.settings.dingtalk || {}), ...body },
        })
        await save()
        return send(res, 200, { ok: true, settings: state.settings, state: snapshot() })
      }
      if (action === '/dws/preview') {
        const preview = await submitReport(body, true)
        return send(res, 200, { ok: true, contents: preview.contents, dryRun: preview.result })
      }
      if (action === '/dws/submit') {
        const submitted = await submitReport(body, false)
        return send(res, 200, { ok: true, delivery: submitted.result, state: snapshot() })
      }
      if (action === '/gitlab/test') {
        const result = await gitlabTest(body)
        return send(res, 200, { ok: true, result })
      }
      if (action === '/gitlab/save') {
        saveGitlab(body)
        await save()
        return send(res, 200, { ok: true, state: snapshot() })
      }
      if (action === '/gitlab/milestones') {
        if (body.projectId) {
          const milestones = await gitlabMilestones(body.projectId)
          return send(res, 200, { ok: true, milestones: milestones.map((item) => ({ ...item, projectId: Number(body.projectId) })) })
        }
        const all = await gitlabMilestonesAll()
        return send(res, 200, { ok: true, milestones: all.milestones, failures: all.failures })
      }
      if (action === '/gitlab/issues') {
        const issues = await gitlabIssues(body.projectId, body.milestoneId)
        return send(res, 200, { ok: true, issues })
      }
      if (action === '/gitlab/issue') {
        const issue = await gitlabCreateIssue(body)
        return send(res, 200, { ok: true, issue })
      }
      if (action === '/gitlab/sync') {
        const result = await gitlabSync(body)
        return send(res, 200, { ok: true, ...result, state: snapshot() })
      }
      if (action === '/gitlab/upload') {
        const uploaded = await gitlabUpload(body.projectId, body.name, body.base64)
        return send(res, 200, { ok: true, ...uploaded })
      }
      if (action === '/gitlab/note') {
        const item = state.items.find((entry) => entry.id === body.itemId)
        if (!item) throw new Error('任务不存在')
        if (!item.link || !item.link.issueIid) throw new Error('先同步到 GitLab，才能发评论')
        const note = await gitlabAddNote(item.link.projectId, item.link.issueIid, String(body.body || ''))
        item.link.lastNoteAt = note.createdAt
        await save()
        return send(res, 200, { ok: true, note })
      }
      if (action === '/gitlab/pull') {
        const result = await gitlabPull(body.itemId, Boolean(body.apply))
        return send(res, 200, { ok: true, ...result, state: snapshot() })
      }
      if (action === '/item/link') {
        const item = linkIssue(body)
        await save()
        return send(res, 200, { ok: true, item, state: snapshot() })
      }
      if (action === '/report/build') {
        return send(res, 200, { ok: true, report: buildReport(body.kind || 'daily', body.key || todayKey()) })
      }
      if (action === '/report/export') {
        const result = await exportReport(body.kind || 'daily', body.key || todayKey())
        return send(res, 200, { ok: true, path: result.path })
      }
      if (action === '/report/export-word') {
        const result = await exportWord(body.kind || 'daily', body.key || todayKey())
        return send(res, 200, { ok: true, path: result.path })
      }
      if (action === '/narrative/save') {
        state.narratives = state.narratives || {}
        const field = String(body.field || 'goals')
        const narrativeKey =
          String(body.kind || 'weekly') + ':' + String(body.key || '') + (field === 'goals' ? '' : ':' + field)
        state.narratives[narrativeKey] = String(body.text || '')
        await save()
        return send(res, 200, { ok: true, state: snapshot() })
      }
      if (action === '/narrative/clear') {
        const field = String(body.field || 'goals')
        const narrativeKey =
          String(body.kind || 'weekly') + ':' + String(body.key || '') + (field === 'goals' ? '' : ':' + field)
        if (state.narratives) delete state.narratives[narrativeKey]
        await save()
        return send(res, 200, { ok: true, state: snapshot() })
      }
      if (action === '/ai/summary') {
        const llm = ctx.get('llm')
        if (!llm) throw new Error('当前环境没有可用的模型服务')
        const defaults = ctx.get('agentDefaultModel')
        const selection = defaults ? defaults.currentSelection() : null
        const provider = selection && selection.provider
        const model = selection && selection.model
        if (!provider || !model) throw new Error('无法确定默认模型，请先在 DSH 设置里选择模型')
        const kind = body.kind || 'daily'
        const key = body.key || todayKey()
        const days = itemsOfPeriod(kind, key)
        const done = days.filter((item) => item.status === 'done')
        const open = days.filter((item) => item.status !== 'done' && item.status !== 'dropped')
        const payload = {
          周期: key,
          完成任务: done.map((item) => ({
            标题: item.title,
            工时: item.spentH ?? item.estimateH ?? null,
            计划: planLabelOf(item),
            周末加班: isOvertimeDate(item.date, state.settings.holidays),
          })),
          未完成: open.map((item) => item.title),
          总工时: buildReport(kind, key).sections.hours,
        }
        const system =
          kind === 'daily'
            ? '你是一名严谨的中文工作助理。根据给定的当日任务数据，写一段“今日小结”，60-120 字。只写事实与结论，不要寒暄，不要用列表符号，不要编造数据里没有的内容。'
            : '你是一名严谨的中文工作助理。根据给定的周期任务数据，写一段“目标推进 / 小结”，120-200 字，概括进展、风险与下一步重点。不要寒暄，不要编造数据里没有的内容。'
        let text = ''
        let failure = null
        for await (const chunk of llm.stream({
          provider,
          model,
          system,
          maxTokens: 700,
          temperature: 0.3,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: '数据（JSON）：\n' + JSON.stringify(payload, null, 2) + '\n\n请直接输出正文，不要解释。',
                },
              ],
            },
          ],
        })) {
          if (chunk.type === 'text-delta') text += chunk.text
          else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
            failure = chunk.reason.failure
          }
        }
        if (failure) throw new Error('模型调用失败：' + (failure.message || failure.code))
        if (!text.trim()) throw new Error('模型没有返回内容')
        return send(res, 200, { ok: true, text: text.trim(), provider, model })
      }
      if (action === '/schedule/run') {
        const before = (state.reports || []).filter((report) => report.status === 'draft' && !report.ack).length
        await tick()
        const after = (state.reports || []).filter((report) => report.status === 'draft' && !report.ack).length
        return send(res, 200, { ok: true, created: Math.max(0, after - before), state: snapshot() })
      }
      if (action === '/dws/selftest') {
        const steps = []
        let status = null
        try {
          const raw = await runDws(['auth', 'status', '--format', 'json'])
          status = {
            authenticated: Boolean(raw.authenticated),
            tokenValid: Boolean(raw.token_valid),
            userName: raw.user_name || '',
            corpName: raw.corp_name || '',
            expiresAt: raw.expires_at || '',
          }
          steps.push({
            name: 'dws 登录态',
            ok: status.authenticated && status.tokenValid,
            detail:
              (status.userName || '未知用户') +
              ' @ ' +
              (status.corpName || '未知组织') +
              (status.expiresAt ? '（至 ' + String(status.expiresAt).slice(0, 16).replace('T', ' ') + '）' : ''),
          })
        } catch (error) {
          steps.push({ name: 'dws 登录态', ok: false, detail: String((error && error.message) || error) })
          return send(res, 200, { ok: true, allOk: false, steps, status: null })
        }

        const ding = dingtalkSettings()
        steps.push({
          name: '日志模板',
          ok: Boolean(ding.templateId),
          detail: ding.templateId
            ? (ding.templateName || ding.templateId) + '（' + (ding.fields || []).length + ' 个字段）'
            : '尚未选择模板',
        })
        const recipients = ding.recipients || []
        steps.push({
          name: '接收人',
          ok: recipients.length > 0,
          detail: recipients.length ? recipients.map((person) => person.name).join('、') : '未设置接收人',
        })
        if (ding.templateId && recipients.length > 0) {
          try {
            const preview = await submitReport(
              {
                kind: 'daily',
                key: todayKey(),
                toUserIds: recipients.map((person) => person.userId),
                risks: '（连通性测试）',
              },
              true,
            )
            steps.push({
              name: '提交演练（dry-run）',
              ok: true,
              detail: '将提交 ' + preview.contents.length + ' 个字段，未真正发送',
            })
          } catch (error) {
            steps.push({ name: '提交演练（dry-run）', ok: false, detail: String((error && error.message) || error) })
          }
        }
        return send(res, 200, { ok: true, allOk: steps.every((step) => step.ok), steps, status })
      }
      if (action === '/report/ack') {
        const report = state.reports.find((entry) => entry.id === body.id)
        if (report) report.ack = true
        await save()
        return send(res, 200, { ok: true, state: snapshot() })
      }
      if (action === '/export') {
        const result = await exportReport('daily', body.date || todayKey())
        return send(res, 200, { ok: true, path: result.path })
      }

      return send(res, 404, { ok: false, error: 'unknown-action', action })
    } catch (error) {
      return send(res, 400, {
        ok: false,
        error: String((error && error.message) || error),
        code: (error && error.code) || undefined,
        action,
      })
    }
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: '/workbench', handler: handle })
    const first = setTimeout(tick, 8000)
    const timer = setInterval(tick, 60000)
    return () => {
      disposeRoute()
      clearTimeout(first)
      clearInterval(timer)
    }
  })
}
