/**
 * 工作台 · Client 半（M2）
 *
 * 四个视图：今日 / 计划 / 统计 / 报告。
 * 数据经 Host 半的 /workbench/api 读写；报告由 Host 渲染成段落 + Markdown。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const C = {
      text: 'var(--dsw-alias-text-primary, #1b1b1f)',
      sub: 'var(--dsw-alias-text-secondary, #6b6b74)',
      line: 'var(--dsw-alias-border-secondary, rgba(0,0,0,0.09))',
      soft: 'var(--dsw-alias-bg-secondary, rgba(0,0,0,0.035))',
      panel: 'var(--dsw-alias-bg-primary, #ffffff)',
      brand: 'var(--wb-accent, #4d6bfe)',
      brandSoft: 'color-mix(in srgb, var(--wb-accent, #4d6bfe) 12%, transparent)',
      brandLine: 'color-mix(in srgb, var(--wb-accent, #4d6bfe) 38%, transparent)',
      grad: 'linear-gradient(135deg, var(--wb-accent, #4d6bfe), var(--wb-accent2, #8b5cf6))',
      danger: 'var(--dsw-alias-text-danger, #d93025)',
      ok: '#10b981',
      warn: '#f59e0b',
      track: 'color-mix(in srgb, var(--dsw-alias-text-primary, #1b1b1f) 10%, transparent)',
    }

    const THEMES = {
      indigo: { name: '靛紫', accent: '#6366f1', accent2: '#a855f7' },
      ocean: { name: '海蓝', accent: '#2563eb', accent2: '#06b6d4' },
      emerald: { name: '青绿', accent: '#10b981', accent2: '#22d3ee' },
    }

    function themeVars(theme) {
      return {
        '--wb-accent': theme.accent,
        '--wb-accent2': theme.accent2,
        '--wb-soft': 'color-mix(in srgb, ' + theme.accent + ' 12%, transparent)',
      }
    }

    const STATUS = { todo: '待办', doing: '进行中', done: '已完成', dropped: '已放弃' }

    // ---------------- utils ----------------

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function toDateStr(date) {
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
    }

    function parseDate(dateStr) {
      return new Date(dateStr + 'T00:00:00')
    }

    function addDays(dateStr, days) {
      const date = parseDate(dateStr)
      date.setDate(date.getDate() + days)
      return toDateStr(date)
    }

    function mondayOf(dateStr) {
      const date = parseDate(dateStr)
      const shift = (date.getDay() + 6) % 7
      date.setDate(date.getDate() - shift)
      return toDateStr(date)
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

    function weekLabel(key) {
      const start = mondayOfWeekKey(key)
      const end = addDays(start, 6)
      return key + '　' + start.slice(5).replace('-', '/') + '–' + end.slice(5).replace('-', '/')
    }

    function daysBetween(from, to) {
      const start = new Date(from + 'T00:00:00')
      const end = new Date(to + 'T00:00:00')
      return Math.round((end - start) / 86400000)
    }

    function shiftMonth(monthKey, delta) {      const parts = monthKey.split('-').map(Number)
      const date = new Date(parts[0], parts[1] - 1 + delta, 1)
      return date.getFullYear() + '-' + pad2(date.getMonth() + 1)
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

    // ---------------- api ----------------

    async function call(action, body) {
      const init =
        body === undefined
          ? {}
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const response = await fetch('/workbench/api' + action, init)
      const payload = await response.json().catch(() => ({ ok: false, error: '返回不是 JSON' }))
      if (!payload.ok) {
        const failure = new Error(payload.error || '请求失败')
        if (payload.code) failure.code = payload.code
        throw failure
      }
      return payload
    }

    // ---------------- atoms ----------------

    function Icon({ size }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': true,
          style: { display: 'block', borderRadius: 7, overflow: 'hidden' },
        },
        h(
          'defs',
          null,
          h(
            'linearGradient',
            { id: 'wbIconGrad', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0', stopColor: '#10B981' }),
            h('stop', { offset: '1', stopColor: '#22D3EE' }),
          ),
        ),
        h('rect', { width: 24, height: 24, rx: 7, fill: 'url(#wbIconGrad)' }),
        h('rect', { x: 6.2, y: 5.2, width: 11.6, height: 2.1, rx: 1.05, fill: '#ffffff', opacity: 0.92 }),
        h('path', {
          d: 'M7.4 12.2l2.1 2.1 4.4-4.4',
          fill: 'none',
          stroke: '#ffffff',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7.4 17.6h8.6',
          stroke: '#ffffff',
          strokeWidth: 2,
          strokeLinecap: 'round',
          opacity: 0.68,
        }),
      )
    }

    function Btn({ children, onClick, primary, disabled, title, small }) {
      return h(
        'button',
        {
          onClick: disabled ? undefined : onClick,
          title,
          style: {
            border: '1px solid ' + (primary ? 'transparent' : C.line),
            background: primary ? C.brand : 'transparent',
            color: primary ? '#fff' : C.text,
            borderRadius: 6,
            cursor: disabled ? 'default' : 'pointer',
            fontWeight: primary ? 600 : 400,
            opacity: disabled ? 0.5 : 1,
            padding: small ? '3px 9px' : '6px 12px',
            fontSize: small ? 12 : 13,
            fontFamily: 'inherit',
          },
        },
        children,
      )
    }

    function Chip({ label, value }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: 6, padding: '4px 10px', borderRadius: 6, background: C.soft } },
        h('span', { style: { fontSize: 12, color: C.sub } }, label),
        h('span', { style: { fontSize: 13, fontWeight: 600, color: C.text } }, value),
      )
    }

    function Segmented({ value, options, onChange }) {
      return h(
        'div',
        { style: { display: 'flex', gap: 2, background: C.soft, borderRadius: 7, padding: 3 } },
        options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              onClick: () => onChange(option.value),
              style: {
                border: 'none',
                borderRadius: 5,
                padding: '4px 12px',
                fontSize: 12.5,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: value === option.value ? C.panel : 'transparent',
                color: value === option.value ? C.text : C.sub,
                fontWeight: value === option.value ? 600 : 400,
              },
            },
            option.label,
          ),
        ),
      )
    }

    function Field({ label, children, grow }) {
      return h(
        'label',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
            color: C.sub,
            flex: grow ? '1 1 0' : '0 0 auto',
          },
        },
        label,
        children,
      )
    }

    function inputStyle(extra) {
      return {
        border: '1px solid ' + C.line,
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 13,
        background: 'transparent',
        color: C.text,
        outline: 'none',
        fontFamily: 'inherit',
        width: '100%',
        boxSizing: 'border-box',
        ...extra,
      }
    }

    function Modal({ title, children, onClose, footer, width }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          {
            style: {
              width: width || 560,
              maxWidth: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              background: C.panel,
              color: C.text,
              borderRadius: 18,
              boxShadow: '0 24px 70px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,.08)',
            },
          },
          h('div', { style: { padding: '14px 18px', borderBottom: '1px solid ' + C.line, fontSize: 14, fontWeight: 600 } }, title),
          h('div', { style: { padding: 18, display: 'flex', flexDirection: 'column', gap: 12 } }, children),
          footer ? h('div', { style: { padding: '12px 18px', borderTop: '1px solid ' + C.line } }, footer) : null,
        ),
      )
    }

    // ---------------- markdown note ----------------

    function escapeHtml(text) {
      return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function inlineMarkdown(text, assetBase) {
      return escapeHtml(text)
        .replace(
          /!\[([^\]]*)\]\(([^)]+)\)/g,
          (match, alt, url) => {
            const src = assetBase && url.indexOf('/') === 0 ? assetBase + url : url
            return '<img src="' + src + '" alt="' + alt + '" style="max-width:100%;border-radius:6px;margin:4px 0" />'
          },
        )
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px">$1</code>')
        .replace(/\[(.+?)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    }

    function renderMarkdown(text, assetBase) {
      const lines = String(text || '').split(/\r?\n/)
      const out = []
      let inList = false
      for (const line of lines) {
        const heading = /^(#{1,3})\s+(.*)$/.exec(line)
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        if (inList && !bullet) {
          out.push('</ul>')
          inList = false
        }
        if (heading) {
          const size = 16 - heading[1].length
          out.push('<div style="font-weight:600;font-size:' + size + 'px;margin:6px 0 2px">' + inlineMarkdown(heading[2], assetBase) + '</div>')
          continue
        }
        if (bullet) {
          if (!inList) {
            out.push('<ul style="margin:4px 0 4px 18px;padding:0">')
            inList = true
          }
          out.push('<li>' + inlineMarkdown(bullet[1], assetBase) + '</li>')
          continue
        }
        if (!line.trim()) {
          out.push('<div style="height:6px"></div>')
          continue
        }
        out.push('<div>' + inlineMarkdown(line, assetBase) + '</div>')
      }
      if (inList) out.push('</ul>')
      return out.join('')
    }

    function NoteEditor({ value, onChange, projectId, notify, allowAssets, assetBase }) {
      const [mode, setMode] = useState('edit')
      const [busy, setBusy] = useState(false)
      const fileRef = React.useRef(null)

      const onFile = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        if (!projectId) return notify('先选 GitLab 项目，再上传附件')
        setBusy(true)
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          const payload = await call('/gitlab/upload', { projectId, name: file.name, base64 })
          const snippet = payload.markdown || '![' + file.name + '](' + payload.url + ')'
          onChange((value ? value + '\n\n' : '') + snippet)
          setMode('preview')
          notify('已上传并插入附件')
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub } },
          h('span', null, '备注（Markdown）'),
          h('div', { style: { flex: 1 } }),
          h(Btn, { small: true, onClick: () => setMode(mode === 'edit' ? 'preview' : 'edit') }, mode === 'edit' ? '预览' : '编辑'),
          allowAssets
            ? h(Btn, { small: true, onClick: () => fileRef.current && fileRef.current.click(), disabled: busy }, '附件')
            : null,
          h('input', { type: 'file', ref: fileRef, onChange: onFile, style: { display: 'none' } }),
        ),
        mode === 'edit'
          ? h('textarea', {
              value,
              rows: 5,
              onChange: (event) => onChange(event.target.value),
              placeholder: '支持 Markdown：**粗体**、`代码`、- 列表、[链接](https://…)',
              style: inputStyle({ resize: 'vertical' }),
            })
          : h('div', {
              style: Object.assign(inputStyle({ minHeight: 110 }), { whiteSpace: 'normal' }),
              dangerouslySetInnerHTML: {
                __html: renderMarkdown(value, assetBase) || '<span style="opacity:.5">（空）</span>',
              },
            }),
      )
    }

    function cardStyle(extra) {
      return Object.assign(
        {
          background: C.panel,
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 10px 28px rgba(0,0,0,.07)',
        },
        extra || {},
      )
    }

    function TextInput({ value, onChange, placeholder, type, autoFocus, width, disabled, multiline, rows }) {
      const [focus, setFocus] = useState(false)
      const base = {
        value: value === null || value === undefined ? '' : value,
        placeholder,
        disabled,
        autoFocus,
        onChange: (event) => onChange(event.target.value),
        onFocus: () => setFocus(true),
        onBlur: () => setFocus(false),
        style: {
          width: width || '100%',
          boxSizing: 'border-box',
          height: multiline ? 'auto' : 34,
          minHeight: multiline ? 76 : undefined,
          padding: multiline ? '8px 10px' : '0 10px',
          fontSize: 13,
          fontFamily: 'inherit',
          color: C.text,
          background: focus ? C.panel : 'transparent',
          border: '1px solid ' + (focus ? C.brandLine : C.line),
          borderRadius: 10,
          outline: 'none',
          resize: multiline ? 'vertical' : 'none',
          boxShadow: focus ? '0 0 0 3px ' + C.brandSoft : 'none',
          transition: 'border-color .12s ease, box-shadow .12s ease',
        },
      }
      return multiline
        ? h('textarea', Object.assign({ rows: rows || 3 }, base))
        : h('input', Object.assign({ type: type || 'text' }, base))
    }

    function Select({ value, options, onChange, placeholder, disabled, width }) {
      const [open, setOpen] = useState(false)
      const ref = React.useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDoc = (event) => {
          if (ref.current && !ref.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
      }, [open])

      const current = options.find((option) => String(option.value) === String(value))

      return h(
        'div',
        { ref, style: { position: 'relative', width: width || '100%' } },
        h(
          'button',
          {
            type: 'button',
            disabled,
            onClick: () => !disabled && setOpen(!open),
            style: {
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 34,
              padding: '0 10px',
              fontSize: 13,
              fontFamily: 'inherit',
              color: current ? C.text : C.sub,
              background: open ? C.brandSoft : 'transparent',
              border: '1px solid ' + (open ? C.brandLine : C.line),
              borderRadius: 10,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.55 : 1,
              textAlign: 'left',
              transition: 'border-color .12s ease, background .12s ease',
            },
          },
          h(
            'span',
            { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            current ? current.label : placeholder || '请选择',
          ),
          h('span', { style: { fontSize: 8, color: C.sub, transform: open ? 'rotate(180deg)' : 'none' } }, '▼'),
        ),
        open
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  zIndex: 60,
                  top: 38,
                  left: 0,
                  right: 0,
                  background: C.panel,
                  borderRadius: 12,
                  boxShadow: '0 14px 36px rgba(0,0,0,.18)',
                  padding: 4,
                  maxHeight: 240,
                  overflow: 'auto',
                },
              },
              options.map((option) => {
                const active = String(option.value) === String(value)
                return h(
                  'div',
                  {
                    key: String(option.value),
                    onMouseDown: (event) => {
                      event.preventDefault()
                      onChange(option.value)
                      setOpen(false)
                    },
                    style: {
                      padding: '7px 10px',
                      borderRadius: 8,
                      fontSize: 13,
                      cursor: 'pointer',
                      color: C.text,
                      background: active ? C.brandSoft : 'transparent',
                      fontWeight: active ? 600 : 400,
                    },
                    onMouseEnter: (event) => {
                      event.currentTarget.style.background = C.brandSoft
                    },
                    onMouseLeave: (event) => {
                      event.currentTarget.style.background = active ? C.brandSoft : 'transparent'
                    },
                  },
                  option.label,
                )
              }),
            )
          : null,
      )
    }

    function isWeekend(dateStr) {
      if (!dateStr) return false
      const day = new Date(dateStr + 'T00:00:00').getDay()
      return day === 0 || day === 6
    }

    function MultiSelect({ values, options, onChange, placeholder }) {
      const [open, setOpen] = useState(false)
      const ref = React.useRef(null)

      useEffect(() => {
        if (!open) return undefined
        const onDoc = (event) => {
          if (ref.current && !ref.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
      }, [open])

      const selected = options.filter((option) => (values || []).indexOf(String(option.value)) >= 0)

      return h(
        'div',
        { ref, style: { position: 'relative' } },
        h(
          'div',
          {
            onClick: () => setOpen(!open),
            style: {
              minHeight: 34,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              alignItems: 'center',
              padding: '4px 8px',
              border: '1px solid ' + (open ? C.brandLine : C.line),
              borderRadius: 10,
              cursor: 'pointer',
              background: open ? C.brandSoft : 'transparent',
            },
          },
          selected.length === 0
            ? h('span', { style: { fontSize: 13, color: C.sub } }, placeholder || '选择…')
            : selected.map((option) =>
                h(
                  'span',
                  {
                    key: option.value,
                    style: { padding: '1px 8px', borderRadius: 999, background: C.brandSoft, fontSize: 11.5, color: C.text },
                  },
                  option.label,
                ),
              ),
          h(
            'span',
            { style: { marginLeft: 'auto', fontSize: 8, color: C.sub, transform: open ? 'rotate(180deg)' : 'none' } },
            '▼',
          ),
        ),
        open
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  zIndex: 60,
                  top: 40,
                  left: 0,
                  right: 0,
                  maxHeight: 220,
                  overflow: 'auto',
                  background: C.panel,
                  borderRadius: 12,
                  boxShadow: '0 14px 36px rgba(0,0,0,.18)',
                  padding: 4,
                },
              },
              options.map((option) => {
                const active = (values || []).indexOf(String(option.value)) >= 0
                return h(
                  'div',
                  {
                    key: option.value,
                    onMouseDown: (event) => {
                      event.preventDefault()
                      const key = String(option.value)
                      onChange(active ? (values || []).filter((value) => value !== key) : (values || []).concat(key))
                    },
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 10px',
                      borderRadius: 8,
                      fontSize: 13,
                      cursor: 'pointer',
                      background: active ? C.brandSoft : 'transparent',
                    },
                  },
                  h('span', { style: { width: 14, color: active ? C.brand : C.sub } }, active ? '☑' : '☐'),
                  h(
                    'span',
                    { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    option.label,
                  ),
                )
              }),
            )
          : null,
      )
    }

    function TrendChart({ state }) {
      const days = []
      for (let offset = 6; offset >= 0; offset -= 1) {
        const dateKey = addDays(state.today, -offset)
        const list = state.items.filter((item) => item.level === 'day' && item.date === dateKey)
        days.push({
          key: dateKey,
          label: dateKey.slice(5).replace('-', '/'),
          done: list.filter((item) => item.status === 'done').length,
          spent: round1(list.reduce((sum, item) => sum + (item.spentH || 0), 0)),
        })
      }
      const maxDone = Math.max(1, ...days.map((day) => day.done))
      const maxSpent = Math.max(1, ...days.map((day) => day.spent))

      return h(
        'div',
        cardStyle({ padding: '12px 14px' }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 } },
          h('span', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, '近 7 天'),
          h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: C.sub } }, '实心=完成数　空心=工时'),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', gap: 8, height: 86 } },
          days.map((day) =>
            h(
              'div',
              {
                key: day.key,
                style: { flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 58 } },
                h('div', {
                  title: '完成 ' + day.done + ' 条',
                  style: {
                    width: 9,
                    height: Math.max(3, Math.round((day.done / maxDone) * 58)),
                    borderRadius: 3,
                    background: C.grad,
                    transition: 'height .3s ease',
                  },
                }),
                h('div', {
                  title: '工时 ' + day.spent + 'h',
                  style: {
                    width: 9,
                    height: Math.max(3, Math.round((day.spent / maxSpent) * 58)),
                    borderRadius: 3,
                    background: 'transparent',
                    border: '1px solid ' + C.brandLine,
                  },
                }),
              ),
              h('div', { style: { fontSize: 10, color: C.sub } }, day.label),
            ),
          ),
        ),
      )
    }

    // ---------------- task form ----------------

    function TaskForm({ state, initial, onClose, onSave, onSync, notify }) {
      const [draft, setDraft] = useState(() => ({
        id: initial && initial.id ? initial.id : undefined,
        level: (initial && initial.level) || 'day',
        title: (initial && initial.title) || '',
        date: (initial && initial.date) || state.today,
        periodKey: (initial && initial.periodKey) || isoWeekKey(state.today),
        estimateH: initial && initial.estimateH !== null && initial.estimateH !== undefined ? String(initial.estimateH) : '',
        spentH: initial && initial.spentH !== null && initial.spentH !== undefined ? String(initial.spentH) : '',
        project: (initial && initial.project) || '',
        priority: (initial && initial.priority) || 'mid',
        parentId: (initial && initial.parentId) || '',
        parentIds:
          initial && Array.isArray(initial.parentIds)
            ? initial.parentIds.map(String)
            : initial && initial.parentId
              ? [String(initial.parentId)]
              : [],
        goalId: (initial && initial.goalId) || '',
        status: (initial && initial.status) || 'todo',
        note: (initial && initial.note) || '',
        dueDate: (initial && initial.dueDate) || '',
        finishedAt: (initial && initial.finishedAt) || '',
        issue: initial && initial.link && initial.link.issueIid ? String(initial.link.issueIid) : '',
        milestoneId: initial && initial.link && initial.link.milestoneId ? String(initial.link.milestoneId) : '',
        issueProjectId:
          (initial && initial.link && initial.link.projectId) ||
          (state.connections &&
            state.connections.gitlab &&
            state.connections.gitlab.projectIds &&
            state.connections.gitlab.projectIds[0]) ||
          '',
      }))
      const [advanced, setAdvanced] = useState(false)
      const [error, setError] = useState('')
      const [syncing, setSyncing] = useState(false)
      const [milestones, setMilestones] = useState([])
      const [milestoneLoading, setMilestoneLoading] = useState(false)

      const isDay = draft.level === 'day'
      const weekKey = isDay ? isoWeekKey(draft.date) : draft.periodKey

      const weekItems = useMemo(
        () => state.items.filter((item) => item.level === 'week' && item.periodKey === weekKey && item.id !== draft.id),
        [state.items, weekKey, draft.id],
      )
      const projects = useMemo(() => {
        const names = new Set()
        for (const item of state.items) if (item.project) names.add(item.project)
        return Array.from(names)
      }, [state.items])

      const gitlabProjects = useMemo(() => {
        const gitlab = state.connections && state.connections.gitlab
        if (!gitlab || !gitlab.hasToken) return []
        const ids = gitlab.projectIds || []
        return (gitlab.projects || []).filter((project) => ids.length === 0 || ids.indexOf(project.id) >= 0)
      }, [state.connections])

      const assetBase = useMemo(() => {
        const gitlab = state.connections && state.connections.gitlab
        return gitlab && gitlab.baseUrl ? String(gitlab.baseUrl).replace(/\/api\/v4\/?$/, '') : ''
      }, [state.connections])

      const createIssue = useCallback(async () => {
        if (!draft.title.trim()) {
          setError('先填标题，再建议题')
          return
        }
        if (!draft.issueProjectId) {
          setError('先选 GitLab 项目（在插件配置页勾选）')
          return
        }
        try {
          const payload = await call('/gitlab/issue', {
            projectId: draft.issueProjectId,
            title: draft.title,
            description: draft.note,
            milestoneId: draft.milestoneId || null,
            issueType: 'task',
          })
          setDraft((current) => ({ ...current, issue: String(payload.issue.iid) }))
          setError('')
          if (notify) notify('已创建 GitLab 任务 #' + payload.issue.iid)
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }, [draft, notify])

      const buildPayload = useCallback(
        () => ({
          id: draft.id,
          level: draft.level,
          title: draft.title.trim(),
          date: isDay ? draft.date : undefined,
          periodKey: isDay ? undefined : draft.periodKey,
          estimateH: draft.estimateH,
          spentH: draft.spentH,
          project: draft.project,
          priority: draft.priority,
          parentId: (draft.parentIds || [])[0] || null,
          parentIds: draft.parentIds || [],
          goalId: draft.goalId || null,
          status: draft.status,
          note: draft.note,
          dueDate: draft.dueDate || null,
          finishedAt: draft.finishedAt || null,
          link: draft.issue
            ? {
                projectId: draft.issueProjectId || null,
                issueIid: String(draft.issue),
                milestoneId: draft.milestoneId || null,
              }
            : null,
        }),
        [draft, isDay],
      )

      const commit = useCallback(() => {
        if (!draft.title.trim()) return setError('标题不能为空')
        Promise.resolve(onSave(buildPayload())).then(onClose, (cause) =>
          setError(String((cause && cause.message) || cause)),
        )
      }, [draft, buildPayload, onSave, onClose])

      const commitAndSync = useCallback(async () => {
        if (!draft.title.trim()) return setError('标题不能为空')
        if (!draft.issueProjectId) return setError('先选择 GitLab 项目')
        setSyncing(true)
        setError('')
        try {
          const saved = await onSave(buildPayload())
          const body = {
            itemId: saved.id,
            projectId: draft.issueProjectId,
            milestoneId: draft.milestoneId || null,
            issueType: 'task',
          }
          let result
          try {
            result = await onSync(body)
          } catch (cause) {
            if (cause && cause.code === 'ISSUE_MISSING' && window.confirm(cause.message)) {
              result = await onSync({ ...body, allowRecreate: true })
            } else {
              throw cause
            }
          }
          const link = result && result.item && result.item.link
          if (notify) {
            const warnings = (result && result.warnings) || []
            notify(
              (result && result.recreated
                ? '原任务已被删除，已重新创建 #'
                : result && result.created
                  ? '已在 GitLab 创建 #'
                  : '已更新 GitLab #') +
                (link ? link.issueIid : '') +
                (result && result.fallback ? '（实例不支持 Task 类型，已建为普通议题）' : '') +
                (result && result.notePushed ? '；备注与附件已作为评论同步' : '') +
                (warnings.length ? '；' + warnings.join('；') : ''),
            )
          }
          onClose()
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setSyncing(false)
        }
      }, [draft, buildPayload, onSave, onSync, notify, onClose])

      useEffect(() => {
        if (!isDay || !draft.issueProjectId) {
          setMilestones([])
          return undefined
        }
        let alive = true
        setMilestoneLoading(true)
        call('/gitlab/milestones', { projectId: draft.issueProjectId })
          .then((payload) => {
            if (alive) setMilestones(payload.milestones || [])
          })
          .catch(() => {
            if (alive) setMilestones([])
          })
          .finally(() => {
            if (alive) setMilestoneLoading(false)
          })
        return () => {
          alive = false
        }
      }, [isDay, draft.issueProjectId])

      const onKeyDown = useCallback(
        (event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            commit()
          }
        },
        [commit],
      )

      return h(
        Modal,
        {
          title: (draft.id ? '编辑' : '新建') + (isDay ? '任务' : draft.level === 'week' ? '周条目' : '月条目'),
          onClose,
          footer: h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            error ? h('div', { style: { flex: 1, color: C.danger, fontSize: 12 } }, error) : null,
            h(Btn, { onClick: onClose }, '取消'),
            isDay && gitlabProjects.length > 0
              ? h(Btn, { onClick: commitAndSync, disabled: syncing }, syncing ? '同步中…' : '保存并同步 GitLab')
              : null,
            h(Btn, { primary: true, onClick: commit }, '保存'),
          ),
        },
        h(
          'div',
          { onKeyDown, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h(Field, { label: '标题' }, h(TextInput, {
            autoFocus: true,
            value: draft.title,
            onChange: (next) => setDraft({ ...draft, title: next }),
            placeholder: '一句话说清交付物',
          })),
          h(
            'div',
            { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            h(
              Field,
              { label: isDay ? '日期' : '所属周期', grow: true },
              isDay
                ? h(TextInput, {
                    type: 'date',
                    value: draft.date,
                    onChange: (next) => setDraft({ ...draft, date: next }),
                  })
                : h(TextInput, {
                    value: draft.level === 'week' ? weekLabel(draft.periodKey) : draft.periodKey,
                    onChange: () => {},
                    disabled: true,
                  }),
            ),
            isDay
              ? h(Field, { label: '预估工时 (h)', grow: true }, h(TextInput, {
                  value: draft.estimateH,
                  onChange: (next) => setDraft({ ...draft, estimateH: next }),
                  placeholder: '2 或 2h',
                }))
              : null,
            h(Field, { label: '优先级', grow: true }, h(Select, {
              value: draft.priority,
              onChange: (next) => setDraft({ ...draft, priority: next }),
              options: [
                { value: 'high', label: '高' },
                { value: 'mid', label: '中' },
                { value: 'low', label: '低' },
              ],
            })),
          ),
          isDay
            ? h(
                'div',
                { style: { display: 'flex', gap: 10 } },
                h(
                  Field,
                  { label: '归属周条目（可多选）', grow: true },
                  h(MultiSelect, {
                    values: draft.parentIds || [],
                    onChange: (next) => setDraft({ ...draft, parentIds: next }),
                    placeholder: '不归属（计划外）',
                    options: weekItems.map((item) => ({ value: item.id, label: item.title })),
                  }),
                ),
              )
            : null,
          h(NoteEditor, {
            value: draft.note,
            onChange: (next) => setDraft({ ...draft, note: next }),
            projectId: draft.issueProjectId,
            allowAssets: isDay,
            assetBase,
            notify,
          }),
          isDay && gitlabProjects.length > 0
            ? h(
                'div',
                {
                  style: {
                    border: '1px solid ' + C.line,
                    borderRadius: 8,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    background: C.soft,
                  },
                },
                h(
                  'div',
                  { style: { fontSize: 12, color: C.sub } },
                  'GitLab（可选，仅日任务）' + (draft.issue ? '　已关联 #' + draft.issue : ''),
                ),
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  h(
                    Field,
                    { label: '项目', grow: true },
                    h(Select, {
                      value: draft.issueProjectId || '',
                      onChange: (next) => setDraft({ ...draft, issueProjectId: next, milestoneId: '' }),
                      options: [{ value: '', label: '不关联' }].concat(
                        gitlabProjects.map((project) => ({
                          value: project.id,
                          label: project.pathWithNamespace || project.name,
                        })),
                      ),
                    }),
                  ),
                  h(
                    Field,
                    { label: '里程碑', grow: true },
                    h(Select, {
                      value: draft.milestoneId || '',
                      onChange: (next) => setDraft({ ...draft, milestoneId: next }),
                      disabled: !draft.issueProjectId,
                      options: [{ value: '', label: milestoneLoading ? '读取中…' : '不挂里程碑' }].concat(
                        milestones.map((milestone) => ({ value: milestone.id, label: milestone.title })),
                      ),
                    }),
                  ),
                ),
                h(
                  Field,
                  { label: '已有任务号（填了就更新那条，不填则新建）' },
                  h(TextInput, {
                    value: draft.issue,
                    onChange: (next) => setDraft({ ...draft, issue: next }),
                    placeholder: '例如 123',
                  }),
                ),
                h(
                  'div',
                  { style: { fontSize: 11, color: C.sub } },
                  '「保存」只存本地；「保存并同步 GitLab」会把标题、描述、里程碑、预估/实际工时推过去。',
                ),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 2 } },
            isDay
              ? null
              : h(Field, { label: '截止日', grow: true }, h(TextInput, {
                  type: 'date',
                  value: draft.dueDate,
                  onChange: (next) => setDraft({ ...draft, dueDate: next }),
                })),
            h(Field, { label: '状态', grow: true }, h(Select, {
              value: draft.status,
              onChange: (next) => setDraft({ ...draft, status: next }),
              options: Object.keys(STATUS).map((key) => ({ value: key, label: STATUS[key] })),
            })),
            isDay
              ? h(Field, { label: '实际工时 (h)', grow: true }, h(TextInput, {
                  value: draft.spentH,
                  onChange: (next) => setDraft({ ...draft, spentH: next }),
                  placeholder: '1.5 或 90m',
                }))
              : h(Field, { label: '实际完成时间', grow: true }, h(TextInput, {
                  type: 'date',
                  value: draft.finishedAt || '',
                  onChange: (next) => setDraft({ ...draft, finishedAt: next }),
                })),
          ),
          h('div', { style: { fontSize: 11, color: C.sub } }, 'Ctrl/⌘ + Enter 保存，Esc 关闭'),
        ),
      )
    }

    // ---------------- shared rows ----------------

    function TaskRow({ item, onToggle, onEdit, onDelete, onComplete }) {
      const [hover, setHover] = useState(false)
      const done = item.status === 'done'
      const priorityLabel = { high: '高', mid: '中', low: '低' }[item.priority] || '中'
      const priorityColor = item.priority === 'high' ? C.danger : item.priority === 'mid' ? C.sub : C.line
      return h(
        'div',
        {
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 10px',
            borderRadius: 8,
            borderBottom: '1px solid ' + C.line,
            background: hover ? C.brandSoft : 'transparent',
            transition: 'background .12s ease',
          },
        },
        h('input', { type: 'checkbox', checked: done, onChange: () => onToggle(item), style: { cursor: 'pointer' } }),
        h(
          'span',
          {
            onClick: () => onEdit(item),
            style: {
              flex: 1,
              cursor: 'pointer',
              textDecoration: done ? 'line-through' : 'none',
              color: done ? C.sub : C.text,
            },
          },
          item.title,
        ),
        h('span', { style: { fontSize: 11, color: priorityColor, minWidth: 14 } }, priorityLabel),
        item.level === 'day' && isWeekend(item.date)
          ? h(
              'span',
              {
                title: '周末工作，自动记为加班',
                style: {
                  fontSize: 10,
                  color: C.warn,
                  border: '1px solid ' + C.warn,
                  borderRadius: 4,
                  padding: '0 4px',
                  lineHeight: 1.5,
                },
              },
              '加班',
            )
          : null,
        item.link && item.link.issueIid ? h('span', { style: { fontSize: 11, color: C.sub } }, '#' + item.link.issueIid) : null,
        h(
          'span',
          { style: { fontSize: 11, color: C.sub, minWidth: 56, textAlign: 'right' } },
          '估 ' + (item.estimateH === null ? '—' : item.estimateH + 'h'),
        ),
        h(
          'span',
          { style: { fontSize: 11, color: item.spentH === null ? C.sub : C.text, minWidth: 56, textAlign: 'right' } },
          '实 ' + (item.spentH === null ? '—' : item.spentH + 'h'),
        ),
        onComplete
          ? h(
              'button',
              {
                onClick: () => onComplete(item),
                title: done
                  ? '重开任务并同步重开 GitLab'
                  : item.link && item.link.issueIid
                    ? '关闭任务并同步关闭 GitLab'
                    : '关闭任务',
                style: {
                  border: 'none',
                  background: 'transparent',
                  color: C.sub,
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '0 2px',
                },
              },
              done ? '重开' : '关闭',
            )
          : h('span', { style: { width: 24 } }),
        hover
          ? h(
              'button',
              {
                onClick: () => onDelete(item),
                title: '删除',
                style: { border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 14 },
              },
              '×',
            )
          : h('span', { style: { width: 12 } }),
      )
    }

    function planLabel(item, allItems) {
      if (!item.parentId) return '计划外'
      const parent = (allItems || []).find((entry) => entry.id === item.parentId)
      return parent ? parent.title : '已删除的计划条目'
    }

    function GroupedList({ items, allItems, onToggle, onEdit, onDelete, onComplete, emptyText }) {
      if (items.length === 0) return h('div', { style: { color: C.sub, fontSize: 13, padding: '18px 0' } }, emptyText)
      const order = []
      const groups = new Map()
      for (const item of items) {
        const key = planLabel(item, allItems)
        if (!groups.has(key)) {
          groups.set(key, [])
          order.push(key)
        }
        groups.get(key).push(item)
      }
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        order.map((project) =>
          h(
            'div',
            { key: project, style: { display: 'flex', flexDirection: 'column', gap: 1 } },
            h('div', { style: { fontSize: 12, color: C.sub, padding: '0 0 4px' } }, project),
            groups.get(project).map((item) => h(TaskRow, { key: item.id, item, onToggle, onEdit, onDelete, onComplete })),
          ),
        ),
      )
    }

    // ---------------- views ----------------

    function Ring({ value, size }) {
      const side = size || 76
      const radius = (side - 9) / 2
      const circumference = 2 * Math.PI * radius
      const pct = Math.max(0, Math.min(1, Number(value) || 0))
      return h(
        'svg',
        { width: side, height: side, viewBox: '0 0 ' + side + ' ' + side, style: { flex: '0 0 auto' } },
        h('circle', { cx: side / 2, cy: side / 2, r: radius, fill: 'none', stroke: C.track, strokeWidth: 7 }),
        h('circle', {
          cx: side / 2,
          cy: side / 2,
          r: radius,
          fill: 'none',
          stroke: C.brand,
          strokeWidth: 7,
          strokeDasharray: circumference * pct + ' ' + circumference,
          strokeLinecap: 'round',
          transform: 'rotate(-90 ' + side / 2 + ' ' + side / 2 + ')',
          style: { transition: 'stroke-dasharray .35s ease' },
        }),
        h(
          'text',
          {
            x: '50%',
            y: '50%',
            textAnchor: 'middle',
            dominantBaseline: 'central',
            fontSize: 15,
            fontWeight: 700,
            fill: C.text,
          },
          Math.round(pct * 100) + '%',
        ),
      )
    }

    function MiniStat({ label, value, accent }) {
      return h(
        'div',
        {
          style: {
            border: '1px solid ' + C.line,
            borderRadius: 12,
            padding: '9px 12px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          },
        },
        h('span', { style: { fontSize: 11, color: C.sub } }, label),
        h('span', { style: { marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: accent || C.text } }, value),
      )
    }

    function WeekProgress({ state }) {
      const monday = mondayOf(state.today)
      const end = addDays(monday, 6)
      const days = state.items.filter((item) => item.level === 'day' && item.date >= monday && item.date <= end)
      const done = days.filter((item) => item.status === 'done').length
      const pct = days.length ? Math.round((done / days.length) * 100) : 0
      return h(
        'div',
        {
          style: {
            border: '1px solid ' + C.line,
            borderRadius: 12,
            padding: '9px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
          },
        },
        h(
          'div',
          { style: { display: 'flex', fontSize: 11, color: C.sub } },
          h('span', null, '本周进度'),
          h('span', { style: { marginLeft: 'auto', color: C.text, fontWeight: 600 } }, done + '/' + days.length),
        ),
        h(
          'div',
          { style: { height: 6, borderRadius: 999, background: C.track, overflow: 'hidden' } },
          h('div', { style: { width: pct + '%', height: '100%', background: C.grad, transition: 'width .35s ease' } }),
        ),
      )
    }

    function WeekPlanList({ state }) {
      const monday = mondayOf(state.today)
      const end = addDays(monday, 6)
      const weekKey = isoWeekKey(state.today)
      const weeks = state.items.filter((item) => item.level === 'week' && item.periodKey === weekKey)
      const days = state.items.filter((item) => item.level === 'day' && item.date >= monday && item.date <= end)
      if (weeks.length === 0) return null
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 } },
        h('div', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, '本周计划条目'),
        weeks.map((week) => {
          const kids = days.filter((item) => item.parentId === week.id)
          const done = kids.filter((item) => item.status === 'done').length
          const spent = round1(kids.reduce((sum, item) => sum + (item.spentH || 0), 0))
          const pct = kids.length ? Math.round((done / kids.length) * 100) : 0
          return h(
            'div',
            {
              key: week.id,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                border: '1px solid ' + C.line,
                borderRadius: 10,
              },
            },
            h('span', { style: { flex: 1, fontSize: 12.5, minWidth: 0 } }, week.title),
            h('span', { style: { fontSize: 11, color: C.sub, width: 54, textAlign: 'right' } }, kids.length ? done + '/' + kids.length : '未拆解'),
            h(
              'div',
              { style: { width: 96, height: 5, borderRadius: 999, background: C.track, overflow: 'hidden' } },
              h('div', { style: { width: pct + '%', height: '100%', background: C.grad } }),
            ),
            h('span', { style: { fontSize: 11, color: C.sub, width: 44, textAlign: 'right' } }, spent ? spent + 'h' : ''),
          )
        }),
      )
    }

    function TodayView({ state, mutate, openForm, notify }) {
      const today = state.today
      const items = useMemo(
        () =>
          state.items
            .filter((item) => item.level === 'day' && item.date === today)
            .slice()
            .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)),
        [state.items, today],
      )
      const stats = useMemo(() => {
        const done = items.filter((item) => item.status === 'done')
        const open = items.filter((item) => item.status !== 'done' && item.status !== 'dropped')
        const spent = items.reduce((sum, item) => sum + (item.spentH || 0), 0)
        const estimate = items.reduce((sum, item) => sum + (item.estimateH || 0), 0)
        return {
          total: items.length,
          done: done.length,
          open: open.length,
          openH: round1(open.reduce((sum, item) => sum + (item.estimateH || 0), 0)),
          spent: round1(spent),
          estimate: round1(estimate),
          offPlan: done.filter((item) => !item.parentId).length,
        }
      }, [items])

      const toggle = useCallback(
        (item) =>
          mutate('/item/save', { id: item.id, status: item.status === 'done' ? 'todo' : 'done' }).catch((cause) =>
            notify(String(cause.message || cause), 'error'),
          ),
        [mutate, notify],
      )
      const remove = useCallback(
        (item) => {
          if (!window.confirm('删除「' + item.title + '」？')) return
          mutate('/item/delete', { id: item.id }).catch((cause) => notify(String(cause.message || cause), 'error'))
        },
        [mutate, notify],
      )

      const complete = useCallback(
        async (item) => {
          try {
            if (item.status === 'done') {
              await mutate('/item/save', { id: item.id, status: 'todo' })
              if (item.link && item.link.issueIid) {
                await mutate('/gitlab/sync', { itemId: item.id })
                notify('已重开，并同步重开 GitLab 任务')
              } else {
                notify('已重开')
              }
              return
            }
            const payload = await mutate('/item/complete', { id: item.id })
            const sync = payload && payload.sync
            if (sync && sync.ok === false) notify('本地已关闭，但 GitLab 同步失败：' + sync.error)
            else if (sync) notify('已关闭，并同步关闭了 GitLab 任务')
            else notify('已关闭')
          } catch (cause) {
            notify(String(cause.message || cause), 'error')
          }
        },
        [mutate, notify],
      )

      return h(
        'div',
        { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } },
        h(
          'div',
          { style: { flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 2px', flexWrap: 'wrap' } },
            h(
              'div',
              { style: { fontSize: 19, fontWeight: 700, letterSpacing: '-.02em' } },
              stats.open === 0 ? (stats.total === 0 ? '今天还没开始' : '今天全部完成 🎉') : '还剩 ' + stats.open + ' 件事',
            ),
            h(
              'div',
              { style: { fontSize: 11.5, color: C.sub } },
              stats.open === 0
                ? '已完成 ' + stats.done + ' 条 · 实际 ' + stats.spent + 'h'
                : '预计还需 ' + stats.openH + 'h · 已完成 ' + stats.done + '/' + stats.total,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h(
              'button',
              {
                onClick: () => openForm(null),
                style: {
                  border: 'none',
                  background: C.grad,
                  color: '#fff',
                  borderRadius: 8,
                  padding: '7px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 2px 10px ' + C.brandLine,
                  transition: 'transform .12s ease, box-shadow .12s ease',
                },
                onMouseEnter: (event) => {
                  event.currentTarget.style.transform = 'translateY(-1px)'
                  event.currentTarget.style.boxShadow = '0 6px 18px ' + C.brandLine
                },
                onMouseLeave: (event) => {
                  event.currentTarget.style.transform = 'translateY(0)'
                  event.currentTarget.style.boxShadow = '0 2px 10px ' + C.brandLine
                },
              },
              '+ 新建任务',
            ),
            h(
              Btn,
              {
                small: true,
                onClick: () => {
                  const open = items.filter((item) => item.status !== 'done' && item.status !== 'dropped')
                  if (open.length === 0) {
                    notify('今天没有未完成的任务')
                    return
                  }
                  if (!window.confirm('把今天 ' + open.length + ' 条未完成任务顺延到明天？\n（会修改这些任务的日期，可再次手动改回）')) {
                    return
                  }
                  mutate('/item/rollover', { date: today }).then(
                    (payload) => notify(payload.moved ? `已顺延 ${payload.moved} 条到 ${payload.target}` : '没有需要顺延的任务'),
                    (cause) => notify(String(cause.message || cause), 'error'),
                  )
                },
              },
              '顺延未完成',
            ),
            h(
              Btn,
              {
                small: true,
                onClick: () =>
                  mutate('/export', { date: today }).then(
                    (payload) => notify('已导出：' + payload.path),
                    (cause) => notify('导出失败：' + String(cause.message || cause), 'error'),
                  ),
              },
              '导出日报',
            ),
          ),
          h(GroupedList, {
            items,
            allItems: state.items,
            onToggle: toggle,
            onComplete: complete,
            onEdit: (item) => openForm(item),
            onDelete: remove,
            emptyText: '今天还没有任务。点「新建任务」记第一条。',
          }),
          h(WeekPlanList, { state }),
          h(TrendChart, { state }),
        ),
        h(
          'div',
          { style: { flex: '0 1 232px', minWidth: 210, display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'div',
            {
              style: {
                border: '1px solid ' + C.line,
                borderRadius: 14,
                padding: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: 'linear-gradient(135deg, ' + C.brandSoft + ', transparent 70%)',
              },
            },
            h(Ring, { value: stats.total === 0 ? 0 : stats.done / stats.total }),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
              h('div', { style: { fontSize: 11, color: C.sub, letterSpacing: '.04em' } }, '今日完成'),
              h('div', { style: { fontSize: 20, fontWeight: 700, lineHeight: 1.2 } }, stats.done + ' / ' + stats.total),
              h(
                'div',
                { style: { fontSize: 11, color: stats.offPlan ? C.warn : C.sub } },
                stats.offPlan ? '计划外 ' + stats.offPlan + ' 条' : '全部在计划内',
              ),
            ),
          ),
          h(MiniStat, { label: '预估工时', value: stats.estimate + 'h', accent: C.brand }),
          h(MiniStat, { label: '实际工时', value: stats.spent + 'h', accent: C.ok }),
          h(WeekProgress, { state }),
        ),
      )
    }

    function GoalRow({ goal, onSave, onDelete }) {
      const [current, setCurrent] = useState(goal.current === null ? '' : String(goal.current))
      useEffect(() => {
        setCurrent(goal.current === null ? '' : String(goal.current))
      }, [goal.current])
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12.5 } },
        h('span', { style: { flex: 1 } }, goal.title),
        h('span', { style: { color: C.sub, fontSize: 12 } }, '目标 ' + (goal.target === null ? '—' : goal.target + (goal.unit || ''))),
        h('input', {
          value: current,
          inputMode: 'decimal',
          onChange: (event) => setCurrent(event.target.value),
          onBlur: () => onSave({ id: goal.id, current }),
          style: inputStyle({ width: 62, padding: '2px 6px', fontSize: 12 }),
        }),
        h('span', { style: { color: C.sub, fontSize: 12 } }, goal.unit || ''),
        h(
          'button',
          {
            onClick: () => onDelete(goal),
            style: { border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 13 },
          },
          '×',
        ),
      )
    }

    function PlanView({ state, mutate, openForm, notify }) {
      const [mode, setMode] = useState('week')
      const [anchor, setAnchor] = useState(state.today)
      const [goalDraft, setGoalDraft] = useState({ title: '', target: '', unit: '' })

      const weekKey = isoWeekKey(anchor)
      const start = mondayOf(anchor)
      const end = addDays(start, 6)
      const monthKey = anchor.slice(0, 7)
      const currentMonday = mondayOf(state.today)
      const maxMonday = addDays(currentMonday, 7)
      const monthMax = shiftMonth(state.today.slice(0, 7), 1)

      const weekItems = useMemo(
        () => state.items.filter((item) => item.level === 'week' && item.periodKey === weekKey),
        [state.items, weekKey],
      )
      const dayItems = useMemo(
        () => state.items.filter((item) => item.level === 'day' && item.date >= start && item.date <= end),
        [state.items, start, end],
      )
      const unassigned = dayItems.filter((item) => !item.parentId)
      const monthItems = useMemo(
        () => state.items.filter((item) => item.level === 'month' && item.periodKey === monthKey),
        [state.items, monthKey],
      )
      const goals = useMemo(() => state.goals.filter((goal) => goal.periodKey === monthKey), [state.goals, monthKey])

      const childrenOf = useCallback((id) => dayItems.filter((item) => item.parentId === id), [dayItems])

      const childSummary = useCallback(
        (id) => {
          const kids = childrenOf(id)
          return {
            done: kids.filter((kid) => kid.status === 'done').length,
            total: kids.length,
            spent: round1(kids.reduce((sum, kid) => sum + (kid.spentH || 0), 0)),
            estimate: round1(kids.reduce((sum, kid) => sum + (kid.estimateH || 0), 0)),
          }
        },
        [childrenOf],
      )

      const monthSummary = useCallback(
        (key) => {
          const days = state.items.filter((item) => item.level === 'day' && item.date && item.date.slice(0, 7) === key)
          return {
            total: days.length,
            spent: round1(days.reduce((sum, item) => sum + (item.spentH || 0), 0)),
            estimate: round1(days.reduce((sum, item) => sum + (item.estimateH || 0), 0)),
          }
        },
        [state.items],
      )

      const delayLabel = useCallback(
        (item) => {
          if (!item.dueDate) return null
          const done = item.status === 'done' && item.finishedAt
          const late = done ? daysBetween(item.dueDate, item.finishedAt) : item.status === 'done' ? 0 : daysBetween(item.dueDate, state.today)
          if (late > 0) return { text: (done ? '延' : '逾期 ') + late + ' 天', color: C.danger }
          if (late < 0 && done) return { text: '提前 ' + Math.abs(late) + ' 天', color: C.sub }
          return null
        },
        [state.today],
      )

      const attach = useCallback(
        (itemId, parentId) =>
          mutate('/item/save', { id: itemId, parentId: parentId || null }).catch((cause) =>
            notify(String(cause.message || cause), 'error'),
          ),
        [mutate, notify],
      )

      const addGoal = useCallback(() => {
        if (!goalDraft.title.trim()) return
        mutate('/goal/save', { periodKey: monthKey, title: goalDraft.title, target: goalDraft.target, unit: goalDraft.unit })
          .then(() => setGoalDraft({ title: '', target: '', unit: '' }))
          .catch((cause) => notify(String(cause.message || cause), 'error'))
      }, [goalDraft, monthKey, mutate, notify])

      if (mode === 'month') {
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h(Segmented, {
              value: mode,
              options: [
                { value: 'week', label: '周' },
                { value: 'month', label: '月' },
              ],
              onChange: setMode,
            }),
            h(Btn, { small: true, onClick: () => setAnchor(shiftMonth(anchor, -1) + '-01') }, '‹'),
            h('div', { style: { fontSize: 13, fontWeight: 600, minWidth: 90 } }, monthKey),
            h(
              Btn,
              {
                small: true,
                disabled: monthKey >= monthMax,
                onClick: () => setAnchor(shiftMonth(anchor, 1) + '-01'),
              },
              '›',
            ),
            h('div', { style: { flex: 1 } }),
            h(Btn, { primary: true, onClick: () => openForm({ level: 'month', periodKey: monthKey }) }, '+ 新建月条目'),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { fontSize: 12, color: C.sub } }, `本月条目 ${monthItems.length} 个`),
            monthItems.length === 0
              ? h('div', { style: { fontSize: 13, color: C.sub } }, '还没有月条目。')
              : monthItems.map((item) =>
                  h(
                    'div',
                    {
                      key: item.id,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        border: '1px solid ' + C.line,
                        borderRadius: 8,
                      },
                    },
                    h(
                      'span',
                      { onClick: () => openForm(item), style: { flex: 1, cursor: 'pointer', fontWeight: 600 } },
                      item.title,
                    ),
                    h('span', { style: { fontSize: 12, color: C.sub } }, (() => {
                      const summary = monthSummary(monthKey)
                      return summary.total === 0 ? '' : `实 ${summary.spent}h / 估 ${summary.estimate}h`
                    })()),
                    (() => {
                      const delay = delayLabel(item)
                      return delay ? h('span', { style: { fontSize: 11, color: delay.color } }, delay.text) : null
                    })(),
                  ),
                ),
          ),
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(Segmented, {
            value: mode,
            options: [
              { value: 'week', label: '周' },
              { value: 'month', label: '月' },
            ],
            onChange: setMode,
          }),
          h(Btn, { small: true, onClick: () => setAnchor(addDays(anchor, -7)) }, '‹'),
          h('div', { style: { fontSize: 13, fontWeight: 600, minWidth: 190 } }, weekLabel(weekKey)),
          h(
            Btn,
            {
              small: true,
              disabled: start >= maxMonday,
              onClick: () => setAnchor(addDays(anchor, 7)),
            },
            '›',
          ),          h(Btn, { small: true, onClick: () => setAnchor(state.today) }, '本周'),
          h('div', { style: { flex: 1 } }),
          h(Btn, { primary: true, onClick: () => openForm({ level: 'week', periodKey: weekKey }) }, '+ 新建周条目'),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { fontSize: 12, color: C.sub } }, `本周条目 ${weekItems.length} 个`),
          weekItems.length === 0
            ? h('div', { style: { color: C.sub, fontSize: 13, padding: '10px 0' } }, '这一周还没有计划条目。先建一条，再把任务归到它下面。')
            : weekItems.map((item) =>
                h(
                  'div',
                  {
                    key: item.id,
                    style: {
                      border: '1px solid ' + C.line,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h(
                      'span',
                      { onClick: () => openForm(item), style: { flex: 1, cursor: 'pointer', fontWeight: 600 } },
                      item.title,
                    ),
                    h(
                      'span',
                      { style: { fontSize: 12, color: C.sub } },
                      (() => {
                        const summary = childSummary(item.id)
                        return summary.total === 0
                          ? '未拆解'
                          : `${summary.done}/${summary.total} · 实 ${summary.spent}h / 估 ${summary.estimate}h`
                      })(),
                    ),
                    (() => {
                      const delay = delayLabel(item)
                      return delay ? h('span', { style: { fontSize: 11, color: delay.color } }, delay.text) : null
                    })(),
                    h(
                      Btn,
                      {
                        small: true,
                        onClick: () =>
                          openForm({ level: 'day', parentId: item.id, date: state.today, project: item.project }),
                      },
                      '+ 子任务',
                    ),
                  ),
                  childrenOf(item.id).length === 0
                    ? h('div', { style: { fontSize: 12, color: C.sub } }, '还没有拆到日的子任务')
                    : childrenOf(item.id).map((child) =>
                        h(
                          'div',
                          { key: child.id, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
                          h(
                            'span',
                            {
                              onClick: () =>
                                mutate('/item/save', { id: child.id, status: child.status === 'done' ? 'todo' : 'done' }),
                              style: {
                                cursor: 'pointer',
                                color: child.status === 'done' ? C.sub : C.text,
                                textDecoration: child.status === 'done' ? 'line-through' : 'none',
                              },
                            },
                            (child.status === 'done' ? '☑ ' : '☐ ') + child.title,
                          ),
                          h('span', { style: { color: C.sub, fontSize: 11 } }, child.date.slice(5)),
                          h('div', { style: { flex: 1 } }),
                          h(Btn, { small: true, onClick: () => attach(child.id, null) }, '取消归属'),
                        ),
                      ),
                ),
              ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 12, color: C.sub } }, `未归拢收件箱 ${unassigned.length} 条（本周内没有归属的任务）`),
          unassigned.length === 0
            ? h('div', { style: { fontSize: 13, color: C.sub } }, '干净，没有未归拢的任务。')
            : unassigned.map((item) =>
                h(
                  'div',
                  {
                    key: item.id,
                    style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: C.soft },
                  },
                  h('span', { style: { flex: 1, fontSize: 12.5 } }, item.title),
                  h('span', { style: { fontSize: 11, color: C.sub } }, item.date.slice(5)),
                  h(
                    'select',
                    {
                      value: '',
                      onChange: (event) => {
                        if (event.target.value) attach(item.id, event.target.value)
                      },
                      style: inputStyle({ width: 160, fontSize: 12, padding: '3px 6px' }),
                    },
                    h('option', { value: '' }, '归入…'),
                    weekItems.map((weekItem) => h('option', { key: weekItem.id, value: weekItem.id }, weekItem.title)),
                  ),
                ),
              ),
        ),
      )
    }

    function StatCard({ label, value, hint }) {
      return h(
        'div',
        {
          style: {
            flex: '1 1 0',
            border: '1px solid ' + C.line,
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          },
        },
        h('div', { style: { fontSize: 12, color: C.sub } }, label),
        h('div', { style: { fontSize: 22, fontWeight: 600 } }, value),
        hint ? h('div', { style: { fontSize: 11, color: C.sub } }, hint) : null,
      )
    }

    function periodRange(scope, today) {
      if (scope === 'week') {
        const start = mondayOf(today)
        return { start, end: addDays(start, 6), label: weekLabel(isoWeekKey(today)) }
      }
      if (scope === 'month') {
        const monthKey = today.slice(0, 7)
        const parts = monthKey.split('-').map(Number)
        const last = new Date(parts[0], parts[1], 0)
        return { start: monthKey + '-01', end: monthKey + '-' + pad2(last.getDate()), label: monthKey }
      }
      const parts = today.split('-').map(Number)
      const quarter = Math.floor((parts[1] - 1) / 3) + 1
      const startMonth = (quarter - 1) * 3 + 1
      const endMonth = startMonth + 2
      const lastDay = new Date(parts[0], endMonth, 0)
      return {
        start: parts[0] + '-' + pad2(startMonth) + '-01',
        end: parts[0] + '-' + pad2(endMonth) + '-' + pad2(lastDay.getDate()),
        label: parts[0] + ' Q' + quarter,
      }
    }

    function holidaysOf(state) {
      const map = new Map()
      for (const entry of (state.settings && state.settings.holidays) || []) {
        if (entry && entry.date) map.set(String(entry.date), entry.kind === 'on' ? 'on' : 'off')
      }
      return map
    }

    function isOvertime(dateStr, map) {
      if (!dateStr) return false
      const marked = map.get(dateStr)
      if (marked === 'on') return false
      if (marked === 'off') return true
      return isWeekend(dateStr)
    }

    function Donut({ segments, size, centerLabel, centerValue, onPick }) {
      const side = size || 176
      const radius = side / 2 - 14
      const circumference = 2 * Math.PI * radius
      const total = segments.reduce((sum, entry) => sum + entry.value, 0)
      let offset = 0
      return h(
        'svg',
        { width: side, height: side, viewBox: '0 0 ' + side + ' ' + side },
        h('circle', { cx: side / 2, cy: side / 2, r: radius, fill: 'none', stroke: C.track, strokeWidth: 15 }),
        segments.map((entry) => {
          const length = total ? (entry.value / total) * circumference : 0
          const node = h(
            'circle',
            {
              key: entry.label,
              cx: side / 2,
              cy: side / 2,
              r: radius,
              fill: 'none',
              stroke: entry.color,
              strokeWidth: 15,
              strokeDasharray: length + ' ' + (circumference - length),
              strokeDashoffset: -offset,
              transform: 'rotate(-90 ' + side / 2 + ' ' + side / 2 + ')',
              style: { cursor: onPick ? 'pointer' : 'default', transition: 'stroke-dasharray .4s ease' },
              onClick: onPick ? () => onPick(entry) : undefined,
            },
            h('title', null, entry.label + '：' + entry.value),
          )
          offset += length
          return node
        }),
        h(
          'text',
          { x: '50%', y: '47%', textAnchor: 'middle', dominantBaseline: 'central', fontSize: 22, fontWeight: 700, fill: C.text },
          centerValue,
        ),
        h(
          'text',
          { x: '50%', y: '63%', textAnchor: 'middle', dominantBaseline: 'central', fontSize: 10, fill: C.sub },
          centerLabel,
        ),
      )
    }

    function LineTrend({ buckets }) {
      const width = 560
      const height = 178
      const padX = 20
      const padY = 18
      const innerW = width - padX * 2
      const innerH = height - padY - 26
      const maxDone = Math.max(1, ...buckets.map((bucket) => bucket.done))
      const maxHours = Math.max(1, ...buckets.map((bucket) => bucket.hours))
      const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : 0
      const point = (index, value, max) => [padX + stepX * index, padY + innerH - (value / max) * innerH]
      const lineOf = (key, max) => buckets.map((bucket, index) => point(index, bucket[key], max).join(',')).join(' ')

      return h(
        'svg',
        { width: '100%', height, viewBox: '0 0 ' + width + ' ' + height, preserveAspectRatio: 'none' },
        [0, 0.5, 1].map((ratio) =>
          h('line', {
            key: ratio,
            x1: padX,
            x2: width - padX,
            y1: padY + innerH * ratio,
            y2: padY + innerH * ratio,
            stroke: C.line,
            strokeDasharray: ratio === 0 ? 'none' : '3 4',
          }),
        ),
        h('polyline', { points: lineOf('hours', maxHours), fill: 'none', stroke: C.warn, strokeWidth: 2, opacity: 0.85 }),
        h('polyline', { points: lineOf('done', maxDone), fill: 'none', stroke: C.brand, strokeWidth: 2.5 }),
        buckets.map((bucket, index) => {
          const coords = point(index, bucket.done, maxDone)
          return h(
            'circle',
            { key: bucket.key, cx: coords[0], cy: coords[1], r: 3.5, fill: C.brand },
            h('title', null, bucket.label + '：完成 ' + bucket.done + ' 条 · 工时 ' + bucket.hours + 'h'),
          )
        }),
        buckets.map((bucket, index) =>
          h(
            'text',
            { key: 'l' + bucket.key, x: padX + stepX * index, y: height - 6, textAnchor: 'middle', fontSize: 9, fill: C.sub },
            bucket.label,
          ),
        ),
      )
    }

    function GroupedBars({ buckets, onPick }) {
      const maxValue = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.estimate, bucket.hours)))
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'flex-end', gap: 8, height: 178, padding: '0 4px', overflowX: 'auto' } },
        buckets.map((bucket) =>
          h(
            'div',
            { key: bucket.key, style: { flex: '1 1 0', minWidth: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 130 } },
              h('div', {
                title: bucket.label + ' 预估 ' + bucket.estimate + 'h',
                style: { width: 12, height: Math.max(2, Math.round((bucket.estimate / maxValue) * 130)), borderRadius: 3, background: C.track },
              }),
              h('div', {
                title: bucket.label + ' 实际 ' + bucket.hours + 'h',
                onClick: onPick ? () => onPick(bucket) : undefined,
                style: {
                  width: 12,
                  height: Math.max(2, Math.round((bucket.hours / maxValue) * 130)),
                  borderRadius: 3,
                  background: C.grad,
                  cursor: onPick ? 'pointer' : 'default',
                },
              }),
            ),
            h('div', { style: { fontSize: 10, color: C.sub } }, bucket.label),
          ),
        ),
      )
    }

    function HBars({ rows, onPick }) {
      const max = Math.max(1, ...rows.map((row) => row.value))
      if (rows.length === 0) return h('div', { style: { fontSize: 12, color: C.sub } }, '暂无数据')
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', flex: 1 } },
        rows.map((row) =>
          h(
            'div',
            {
              key: row.key,
              onClick: onPick ? () => onPick(row) : undefined,
              style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: onPick ? 'pointer' : 'default' },
            },
            h(
              'span',
              { style: { width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text } },
              row.key,
            ),
            h(
              'div',
              { style: { flex: 1, height: 9, borderRadius: 999, background: C.track, overflow: 'hidden' } },
              h('div', { style: { width: Math.round((row.value / max) * 100) + '%', height: '100%', background: C.grad } }),
            ),
            h('span', { style: { width: 28, textAlign: 'right', color: C.sub, fontWeight: 600 } }, row.value),
          ),
        ),
      )
    }

    function ChartCard({ title, hint, children, actions }) {
      return h(
        'div',
        cardStyle({ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, width: '100%', minHeight: 248 }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('span', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, title),
          actions || null,
          hint ? h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: C.sub } }, hint) : null,
        ),
        children,
      )
    }

    function StatsPage({ state }) {
      const [scope, setScope] = useState('week')
      const [drill, setDrill] = useState(null)
      const range = periodRange(scope, state.today)
      const holidayMap = useMemo(() => holidaysOf(state), [state.settings])

      const days = useMemo(
        () =>
          state.items.filter(
            (item) => item.level === 'day' && item.date && item.date >= range.start && item.date <= range.end,
          ),
        [state.items, range.start, range.end],
      )

      const done = days.filter((item) => item.status === 'done')
      const open = days.filter((item) => item.status !== 'done' && item.status !== 'dropped')
      const donePlanned = done.filter((item) => item.parentId)
      const doneOffPlan = done.filter((item) => !item.parentId)
      const planned = days.filter((item) => item.parentId)
      const spent = round1(days.reduce((sum, item) => sum + (item.spentH || 0), 0))
      const estimate = round1(days.reduce((sum, item) => sum + (item.estimateH || 0), 0))
      const overtime = days.filter((item) => isOvertime(item.date, holidayMap))
      const overtimeHours = round1(overtime.reduce((sum, item) => sum + (item.spentH || 0), 0))

      const completion = days.length ? Math.round((done.length / days.length) * 100) : 0
      const planRate = planned.length ? Math.round((donePlanned.length / planned.length) * 100) : null
      const offRate = done.length ? Math.round((doneOffPlan.length / done.length) * 100) : null

      const buckets = useMemo(() => {
        const list = []
        if (scope === 'week') {
          const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
          for (let index = 0; index < 7; index += 1) {
            const dateKey = addDays(range.start, index)
            const dayItems = days.filter((item) => item.date === dateKey)
            list.push({
              key: dateKey,
              label: weekdayNames[index],
              done: dayItems.filter((item) => item.status === 'done').length,
              hours: round1(dayItems.reduce((sum, item) => sum + (item.spentH || 0), 0)),
              estimate: round1(dayItems.reduce((sum, item) => sum + (item.estimateH || 0), 0)),
              items: dayItems,
            })
          }
        } else if (scope === 'month') {
          const weeks = new Map()
          for (const item of days) {
            const key = isoWeekKey(item.date)
            if (!weeks.has(key)) weeks.set(key, [])
            weeks.get(key).push(item)
          }
          for (const entry of Array.from(weeks.entries()).sort()) {
            const key = entry[0]
            const list2 = entry[1]
            list.push({
              key,
              label: key.slice(-2) + '周',
              done: list2.filter((item) => item.status === 'done').length,
              hours: round1(list2.reduce((sum, item) => sum + (item.spentH || 0), 0)),
              estimate: round1(list2.reduce((sum, item) => sum + (item.estimateH || 0), 0)),
              items: list2,
            })
          }
        } else {
          for (let month = 1; month <= 12; month += 1) {
            const prefix = range.start.slice(0, 4) + '-' + pad2(month)
            if (prefix < range.start.slice(0, 7) || prefix > range.end.slice(0, 7)) continue
            const list2 = days.filter((item) => item.date.slice(0, 7) === prefix)
            list.push({
              key: prefix,
              label: month + '月',
              done: list2.filter((item) => item.status === 'done').length,
              hours: round1(list2.reduce((sum, item) => sum + (item.spentH || 0), 0)),
              estimate: round1(list2.reduce((sum, item) => sum + (item.estimateH || 0), 0)),
              items: list2,
            })
          }
        }
        return list
      }, [scope, days, range.start, range.end])

      const planRows = useMemo(() => {
        const counter = new Map()
        for (const item of done) {
          const key = planLabel(item, state.items)
          counter.set(key, (counter.get(key) || 0) + 1)
        }
        return Array.from(counter.entries())
          .map((entry) => ({ key: entry[0], value: entry[1] }))
          .sort((left, right) => right.value - left.value)
          .slice(0, 7)
      }, [done, state.items])

      const tile = (label, value, hint, accent) =>
        h(
          'div',
          cardStyle({ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }),
          h('div', { style: { fontSize: 11.5, color: C.sub, letterSpacing: '.05em' } }, label),
          h('div', { style: { fontSize: 27, fontWeight: 700, color: accent || C.text, letterSpacing: '-.02em', lineHeight: 1.15 } }, value),
          hint ? h('div', { style: { fontSize: 11, color: C.sub } }, hint) : null,
        )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(Segmented, {
            value: scope,
            options: [
              { value: 'week', label: '本周' },
              { value: 'month', label: '本月' },
              { value: 'quarter', label: '本季' },
            ],
            onChange: setScope,
          }),
          h('div', { style: { fontSize: 12, color: C.sub } }, range.label),
          h('div', { style: { flex: 1 } }),
          h('div', { style: { fontSize: 11, color: C.sub } }, range.start + ' ~ ' + range.end),
        ),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10 } },
          tile('完成率', completion + '%', done.length + ' / ' + days.length + ' 条'),
          tile('计划达成', planRate === null ? '—' : planRate + '%', '计划外 ' + (offRate === null ? '—' : offRate + '%'), C.brand),
          tile('实际工时', spent + 'h', '预估 ' + estimate + 'h'),
          tile('加班工时', overtimeHours + 'h', overtime.length + ' 条非工作日', overtimeHours ? C.warn : C.text),
        ),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10, alignItems: 'stretch' } },
          h(
            'div',
            { style: { display: 'flex' } },
            h(
              ChartCard,
              { title: '任务构成', hint: '点击扇区查看清单' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' } },
                h(Donut, {
                  segments: [
                    { label: '计划内完成', value: donePlanned.length, color: C.brand },
                    { label: '计划外完成', value: doneOffPlan.length, color: C.warn },
                    { label: '未完成', value: open.length, color: C.track },
                  ],
                  centerValue: completion + '%',
                  centerLabel: '完成率',
                  onPick: (entry) => {
                    const list =
                      entry.label === '计划内完成' ? donePlanned : entry.label === '计划外完成' ? doneOffPlan : open
                    setDrill({ title: entry.label, items: list })
                  },
                }),
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5 } },
                  [
                    { label: '计划内完成', value: donePlanned.length, color: C.brand },
                    { label: '计划外完成', value: doneOffPlan.length, color: C.warn },
                    { label: '未完成', value: open.length, color: C.track },
                  ].map((row) =>
                    h(
                      'div',
                      { key: row.label, style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', { style: { width: 8, height: 8, borderRadius: 999, background: row.color } }),
                      h('span', { style: { color: C.sub } }, row.label),
                      h('span', { style: { marginLeft: 'auto', fontWeight: 600 } }, row.value),
                    ),
                  ),
                ),
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex' } },
            h(
              ChartCard,
              {
                title: '完成与工时趋势',
                hint: '悬停看单点',
                actions: h(
                  'span',
                  { style: { marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: C.sub } },
                  h('span', { style: { width: 12, height: 3, borderRadius: 2, background: C.brand } }),
                  '完成数',
                  h('span', { style: { width: 12, height: 3, borderRadius: 2, background: C.warn, marginLeft: 6 } }),
                  '工时',
                ),
              },
              h(LineTrend, { buckets }),
            ),
          ),
        ),
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10, alignItems: 'stretch' } },
          h(
            'div',
            { style: { display: 'flex' } },
            h(
              ChartCard,
              { title: '预估 vs 实际工时', hint: '点击实际柱查看任务' },
              h(GroupedBars, {
                buckets,
                onPick: (bucket) => setDrill({ title: bucket.label + ' 的任务', items: bucket.items }),
              }),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex' } },
            h(
              ChartCard,
              { title: '计划条目分布', hint: '点击查看清单' },
              h(HBars, {
                rows: planRows,
                onPick: (row) =>
                  setDrill({
                    title: row.key,
                    items: done.filter((item) => planLabel(item, state.items) === row.key),
                  }),
              }),
            ),
          ),
        ),
        drill
          ? h(
              Modal,
              {
                title: drill.title + '（' + drill.items.length + '）',
                width: 560,
                onClose: () => setDrill(null),
                footer: h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'flex-end' } },
                  h(Btn, { onClick: () => setDrill(null) }, '关闭'),
                ),
              },
              drill.items.length === 0
                ? h('div', { style: { fontSize: 12.5, color: C.sub } }, '没有任务')
                : drill.items.map((item) =>
                    h(
                      'div',
                      {
                        key: item.id,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12.5,
                          padding: '4px 0',
                          borderBottom: '1px solid ' + C.line,
                        },
                      },
                      h('span', { style: { flex: 1 } }, item.title),
                      h('span', { style: { color: C.sub, fontSize: 11 } }, item.date.slice(5)),
                      h(
                        'span',
                        { style: { color: C.sub, fontSize: 11, width: 46, textAlign: 'right' } },
                        item.spentH ? item.spentH + 'h' : '',
                      ),
                      h(
                        'span',
                        { style: { color: item.status === 'done' ? C.ok : C.sub, fontSize: 10.5, width: 36 } },
                        item.status === 'done' ? '完成' : '未完成',
                      ),
                    ),
                  ),
            )
          : null,
      )
    }

    function StatsView({ state }) {
      const today = state.today
      const anchor = mondayOf(today)
      const weekKey = isoWeekKey(today)

      const series = useMemo(() => {
        const list = []
        for (let index = 7; index >= 0; index -= 1) {
          const monday = addDays(anchor, -7 * index)
          const end = addDays(monday, 6)
          const days = state.items.filter((item) => item.level === 'day' && item.date >= monday && item.date <= end)
          list.push({
            key: isoWeekKey(monday),
            start: monday,
            total: days.length,
            done: days.filter((item) => item.status === 'done').length,
          })
        }
        return list
      }, [state.items, anchor])

      const metrics = useMemo(() => {
        const current = series[series.length - 1]
        const days = state.items.filter(
          (item) => item.level === 'day' && item.date >= current.start && item.date <= addDays(current.start, 6),
        )
        const planned = days.filter((item) => item.parentId)
        const done = days.filter((item) => item.status === 'done')
        const donePlanned = done.filter((item) => item.parentId)
        const offPlan = done.filter((item) => !item.parentId)
        const ratios = done.filter((item) => item.estimateH && item.spentH).map((item) => item.spentH / item.estimateH)
        const weekend = days.filter((item) => isWeekend(item.date))
        return {
          rate: planned.length ? Math.round((donePlanned.length / planned.length) * 100) : null,
          plannedCount: planned.length,
          offPlanRate: done.length ? Math.round((offPlan.length / done.length) * 100) : null,
          doneCount: done.length,
          deviation: median(ratios),
          overtimeCount: weekend.length,
          overtimeHours: round1(weekend.reduce((sum, item) => sum + (item.spentH || 0), 0)),
        }
      }, [series, state.items])

      const byProject = useMemo(() => {
        const current = series[series.length - 1]
        const end = addDays(current.start, 6)
        const counter = new Map()
        for (const item of state.items) {
          if (item.level !== 'day' || item.status !== 'done') continue
          if (item.date < current.start || item.date > end) continue
          const key = planLabel(item, state.items)
          counter.set(key, (counter.get(key) || 0) + 1)
        }
        return Array.from(counter.entries()).sort((a, b) => b[1] - a[1])
      }, [series, state.items])

      const maxDone = Math.max(1, ...series.map((entry) => entry.done))
      const maxProject = Math.max(1, ...byProject.map((entry) => entry[1]))

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 20 } },
        h('div', { style: { fontSize: 12, color: C.sub } }, `统计口径：${weekLabel(weekKey)}（周一至周日）`),
        h(
          'div',
          { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
          h(StatCard, {
            label: '计划达成率',
            value: metrics.rate === null ? '—' : metrics.rate + '%',
            hint: metrics.plannedCount ? `${metrics.plannedCount} 条挂了计划的日任务` : '本周还没有挂计划的日任务',
          }),
          h(StatCard, {
            label: '计划外占比',
            value: metrics.offPlanRate === null ? '—' : metrics.offPlanRate + '%',
            hint: metrics.doneCount ? `已完成 ${metrics.doneCount} 条` : '本周还没有完成任务',
          }),
          h(StatCard, {
            label: '估算偏差',
            value: metrics.deviation === null ? '—' : round1(metrics.deviation) + '×',
            hint: '实际 ÷ 预估 的中位数',
          }),
          h(StatCard, {
            label: '周末加班',
            value: metrics.overtimeHours + 'h',
            hint: metrics.overtimeCount ? `${metrics.overtimeCount} 条周末任务` : '本周没有周末任务',
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { fontSize: 12, color: C.sub } }, '近 8 周完成数'),
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                height: 110,
                padding: '0 4px',
                borderBottom: '1px solid ' + C.line,
              },
            },
            series.map((entry) =>
              h(
                'div',
                {
                  key: entry.key,
                  title: `${entry.key}：完成 ${entry.done} / 共 ${entry.total}`,
                  style: { flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
                },
                h('div', { style: { fontSize: 11, color: C.sub } }, entry.done || ''),
                h('div', {
                  style: {
                    width: '70%',
                    height: Math.max(4, Math.round((entry.done / maxDone) * 72)),
                    background: entry.key === weekKey ? C.brand : C.line,
                    borderRadius: 3,
                  },
                }),
                h('div', { style: { fontSize: 10, color: C.sub } }, entry.key.slice(-2)),
              ),
            ),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { fontSize: 12, color: C.sub } }, '本周计划条目分布'),
          byProject.length === 0
            ? h('div', { style: { fontSize: 13, color: C.sub } }, '本周还没有完成的任务')
            : byProject.map(([project, count]) =>
                h(
                  'div',
                  { key: project, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
                  h('span', { style: { width: 110 } }, project),
                  h(
                    'div',
                    { style: { flex: 1, background: C.soft, borderRadius: 3, height: 8 } },
                    h('div', {
                      style: { width: Math.round((count / maxProject) * 100) + '%', background: C.brand, height: 8, borderRadius: 3 },
                    }),
                  ),
                  h('span', { style: { width: 24, textAlign: 'right', color: C.sub } }, count),
                ),
              ),
        ),
      )
    }

    function SubmitModal({ state, report, onClose, notify }) {
      const ding = (state.settings && state.settings.dingtalk) || {}
      const recipients = ding.recipients || []
      const [risks, setRisks] = useState('')
      const [contents, setContents] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [done, setDone] = useState(null)

      const payloadOf = () => ({
        kind: report.kind,
        key: report.key,
        toUserIds: recipients.map((person) => person.userId),
        risks,
      })

      const preview = async () => {
        setBusy(true)
        setError('')
        try {
          const payload = await call('/dws/preview', payloadOf())
          setContents(payload.contents)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy(false)
        }
      }

      const submit = async () => {
        setBusy(true)
        setError('')
        try {
          const payload = await call('/dws/submit', payloadOf())
          setDone(payload.delivery)
          notify('已提交钉钉日志')
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy(false)
        }
      }

      const ready = Boolean(ding.templateId) && recipients.length > 0

      return h(
        Modal,
        {
          title: '提交到钉钉日志',
          onClose,
          width: 620,
          footer: h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            h(Btn, { onClick: preview, disabled: busy || !ready }, '预览（dry-run）'),
            h(Btn, { primary: true, onClick: submit, disabled: busy || !ready || Boolean(done) }, done ? '已提交' : '确认提交'),
          ),
        },
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 } },
          h(
            'div',
            { style: { color: C.sub } },
            '模板：' + (ding.templateName || '未选择') + '　｜　日期：' + report.key,
          ),
          !ding.templateId
            ? h('div', { style: { color: C.danger } }, '还没选模板：请到「插件 → 工作台 → 配置」里选择日志模板。')
            : null,
          recipients.length === 0
            ? h('div', { style: { color: C.danger } }, '还没选接收人：不选接收人，日志提交后对任何人都不可见。')
            : h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                recipients.map((person) =>
                  h(
                    'span',
                    {
                      key: person.userId,
                      style: { padding: '3px 8px', borderRadius: 999, background: C.soft, fontSize: 12 },
                    },
                    person.name,
                  ),
                ),
              ),
          h(Field, { label: '需协调工作（可留空）' }, h('textarea', {
            value: risks,
            rows: 2,
            onChange: (event) => setRisks(event.target.value),
            placeholder: '例如：测试环境不可用，需要运维配合',
            style: inputStyle({ resize: 'vertical' }),
          })),
          contents
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { color: C.sub } }, '将提交的内容'),
                contents.map((row) =>
                  h(
                    'div',
                    { key: row.key, style: { border: '1px solid ' + C.line, borderRadius: 8, padding: '6px 8px' } },
                    h('div', { style: { fontSize: 11, color: C.sub } }, row.key + ' · type=' + row.type),
                    h(
                      'div',
                      { style: { whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'hidden', fontSize: 12 } },
                      row.content,
                    ),
                  ),
                ),
              )
            : null,
          error ? h('div', { style: { color: C.danger, whiteSpace: 'pre-wrap' } }, error) : null,
          done
            ? h(
                'div',
                {
                  style: {
                    border: '1px solid ' + C.line,
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: C.soft,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  },
                },
                (done.link ? '已在钉钉创建日志：' + done.link + '\n' : '已提交。\n') +
                  (done.reportId ? 'reportId: ' + done.reportId : ''),
              )
            : null,
        ),
      )
    }

    function DocEditor({ label, hint, value, onChange, onSave, onReset, canReset, placeholder, busy }) {
      const [focus, setFocus] = useState(false)
      const ref = React.useRef(null)
      const text = value || ''

      const wrapSelection = (before, after) => {
        const node = ref.current
        if (!node) return
        const start = node.selectionStart
        const end = node.selectionEnd
        const selected = text.slice(start, end) || '文字'
        onChange(text.slice(0, start) + before + selected + after + text.slice(end))
        window.setTimeout(() => {
          node.focus()
          node.setSelectionRange(start + before.length, start + before.length + selected.length)
        }, 0)
      }

      const prefixLine = (prefix) => {
        const node = ref.current
        if (!node) return
        const start = node.selectionStart
        const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
        onChange(text.slice(0, lineStart) + prefix + text.slice(lineStart))
        window.setTimeout(() => {
          node.focus()
          node.setSelectionRange(start + prefix.length, start + prefix.length)
        }, 0)
      }

      const tool = (labelText, onClick, title) =>
        h(
          'button',
          {
            type: 'button',
            title,
            onMouseDown: (event) => {
              event.preventDefault()
              onClick()
            },
            style: {
              border: 'none',
              background: 'transparent',
              color: C.sub,
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 7px',
              borderRadius: 6,
              fontFamily: 'inherit',
            },
            onMouseEnter: (event) => {
              event.currentTarget.style.background = C.brandSoft
            },
            onMouseLeave: (event) => {
              event.currentTarget.style.background = 'transparent'
            },
          },
          labelText,
        )

      return h(
        'div',
        cardStyle({ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px' }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('span', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, label),
          hint ? h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: C.sub } }, hint) : null,
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              opacity: focus ? 1 : 0.35,
              transition: 'opacity .15s ease',
              borderBottom: '1px solid ' + C.line,
              paddingBottom: 4,
            },
          },
          tool('B', () => wrapSelection('**', '**'), '加粗'),
          tool('`', () => wrapSelection('`', '`'), '行内代码'),
          tool('•', () => prefixLine('- '), '列表'),
          tool('H', () => prefixLine('## '), '小标题'),
        ),
        h('textarea', {
          ref,
          value: text,
          placeholder,
          onChange: (event) => onChange(event.target.value),
          onFocus: () => setFocus(true),
          onBlur: () => setFocus(false),
          style: {
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            background: 'transparent',
            color: C.text,
            fontSize: 13,
            lineHeight: 1.9,
            fontFamily: 'inherit',
            minHeight: 150,
            padding: 0,
          },
        }),
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              borderTop: '1px solid ' + C.line,
              paddingTop: 8,
            },
          },
          h(Btn, { small: true, onClick: onSave, disabled: busy }, busy ? '保存中…' : '保存'),
          canReset ? h(Btn, { small: true, onClick: onReset, disabled: busy }, '恢复自动') : null,
        ),
      )
    }

    function LeftEditor({ report, kind, periodKey, notify, onSaved }) {
      const current = report.sections.left
      const overridden = Boolean(report.overrides && report.overrides.left)
      const [text, setText] = useState(current)
      const [busy, setBusy] = useState(false)
      const lastSaved = React.useRef(current)

      useEffect(() => {
        setText(current)
        lastSaved.current = current
      }, [current, kind, periodKey])

      const save = async () => {
        if (busy) return
        if (text === lastSaved.current) return
        setBusy(true)
        try {
          await call('/narrative/save', { kind, key: periodKey, field: 'left', text })
          lastSaved.current = text
          if (onSaved) onSaved()
          notify('已保存「未完成工作和明天计划」')
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }

      const reset = async () => {
        setBusy(true)
        try {
          await call('/narrative/clear', { kind, key: periodKey, field: 'left' })
          if (onSaved) onSaved()
          notify('已恢复为自动汇总')
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }

      return h(DocEditor, {
        label: '未完成工作和明天计划',
        hint: overridden ? '已手改' : '自动汇总，可直接补充明日计划',
        value: text,
        onChange: setText,
        onSave: save,
        onReset: reset,
        canReset: overridden,
        placeholder: '　· 未完成的 xxx\n　· 明日：xxx',
        busy,
      })
    }

    function NarrativePanel({ state, kind, periodKey, notify, onSaved }) {
      const saved = (state.narratives && state.narratives[kind + ':' + periodKey]) || ''
      const [text, setText] = useState(saved)
      const [busy, setBusy] = useState(false)
      const lastSaved = React.useRef(saved)

      useEffect(() => {
        setText(saved)
        lastSaved.current = saved
      }, [saved, kind, periodKey])

      const save = async () => {
        if (busy) return
        if (text === lastSaved.current) return
        setBusy(true)
        try {
          await call('/narrative/save', { kind, key: periodKey, text })
          lastSaved.current = text
          if (onSaved) onSaved()
          notify('已保存目标推进')
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }

      return h(DocEditor, {
        label: kind === 'weekly' ? '本周目标推进 / 小结' : '本月目标达成',
        hint: '保存后写入报告对应段落',
        value: text,
        onChange: setText,
        onSave: save,
        canReset: false,
        placeholder: '例如：合同模块二期进入联调，接口可用性从 82% 提升到 88%；下月重点是试点上线。',
        busy,
      })
    }

    function InlineArea({ value, onChange, onCommit, placeholder }) {
      const ref = React.useRef(null)
      const [focus, setFocus] = useState(false)

      useEffect(() => {
        const node = ref.current
        if (!node) return
        node.style.height = 'auto'
        node.style.height = Math.max(60, node.scrollHeight) + 'px'
      }, [value])

      return h(
        'div',
        {
          style: {
            position: 'relative',
            margin: '-4px -10px',
            padding: '4px 10px',
            borderRadius: 10,
            background: focus ? C.brandSoft : 'transparent',
            transition: 'background .15s ease',
          },
        },
        h('textarea', {
          ref,
          value,
          placeholder,
          onChange: (event) => onChange(event.target.value),
          onFocus: () => setFocus(true),
          onBlur: () => {
            setFocus(false)
            if (onCommit) onCommit()
          },
          style: {
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
            background: 'transparent',
            color: C.text,
            fontSize: 13,
            lineHeight: 1.95,
            fontFamily: 'inherit',
            padding: 0,
            display: 'block',
          },
        }),
      )
    }

    function DocSection({ title, hint, children, accent, extra }) {
      return h(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: '1px solid ' + C.line, paddingBottom: 6 } },
          h(
            'span',
            {
              style: {
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: '.06em',
                color: accent ? C.brand : C.sub,
              },
            },
            title,
          ),
          hint ? h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: C.sub } }, hint) : null,
          extra || null,
        ),
        children,
      )
    }

    function ReportDoc({ state, notify }) {
      const [kind, setKind] = useState('daily')
      const [key, setKey] = useState(state.today)
      const [report, setReport] = useState(null)
      const [busy, setBusy] = useState(false)
      const [submitOpen, setSubmitOpen] = useState(false)
      const [leftText, setLeftText] = useState('')
      const [goalsText, setGoalsText] = useState('')
      const [aiBusy, setAiBusy] = useState(false)
      const [aiPreview, setAiPreview] = useState(null)
      const lastLeft = React.useRef('')
      const lastGoals = React.useRef('')

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const payload = await call('/report/build', { kind, key })
          setReport(payload.report)
          setLeftText(payload.report.sections.left)
          setGoalsText(payload.report.sections.goals)
          lastLeft.current = payload.report.sections.left
          lastGoals.current = payload.report.sections.goals
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }, [kind, key, notify])

      useEffect(() => {
        load()
      }, [load])

      const changeKind = useCallback(
        (next) => {
          setKind(next)
          setKey(next === 'daily' ? state.today : next === 'weekly' ? isoWeekKey(state.today) : state.today.slice(0, 7))
        },
        [state.today],
      )

      const shift = useCallback(
        (delta) => {
          if (kind === 'daily') setKey(addDays(key, delta))
          else if (kind === 'weekly') setKey(isoWeekKey(addDays(mondayOfWeekKey(key), delta * 7)))
          else setKey(shiftMonth(key, delta))
        },
        [kind, key],
      )

      const saveField = async (field, text, previous, label) => {
        if (text === previous) return
        try {
          await call('/narrative/save', { kind, key, field, text })
          if (field === 'left') lastLeft.current = text
          else lastGoals.current = text
          await load()
          notify('已更新' + label)
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        }
      }

      const runAi = useCallback(
        async (field) => {
          setAiBusy(true)
          try {
            const payload = await call('/ai/summary', { kind, key })
            setAiPreview({ text: payload.text, field })
          } catch (cause) {
            notify(String(cause.message || cause), 'error')
          } finally {
            setAiBusy(false)
          }
        },
        [kind, key, notify],
      )

      const applyAi = useCallback(async () => {
        if (!aiPreview) return
        const { text, field } = aiPreview
        setAiPreview(null)
        if (field === 'left') {
          setLeftText(text)
          await saveField('left', text, lastLeft.current, '未完成段')
        } else {
          setGoalsText(text)
          await saveField('goals', text, lastGoals.current, '目标推进')
        }
      }, [aiPreview, saveField])

      const resetDefaults = useCallback(async () => {
        setBusy(true)
        try {
          await call('/narrative/clear', { kind, key, field: 'left' })
          if (kind !== 'daily') await call('/narrative/clear', { kind, key, field: 'goals' })
          await load()
          notify('已恢复默认内容')
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }, [kind, key, load, notify])

      const copy = useCallback(() => {
        if (!report) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(report.markdown).then(
            () => notify('已复制到剪贴板'),
            () => notify('复制失败，请手动选中', 'error'),
          )
        } else {
          notify('当前环境不支持剪贴板', 'error')
        }
      }, [report, notify])

      const exportFile = useCallback(() => {
        call('/report/export', { kind, key }).then(
          (payload) => notify('已导出：' + payload.path),
          (cause) => notify('导出失败：' + String(cause.message || cause), 'error'),
        )
      }, [kind, key, notify])

      const exportWord = useCallback(() => {
        call('/report/export-word', { kind, key }).then(
          (payload) => notify('已导出 Word：' + payload.path),
          (cause) => notify('导出 Word 失败：' + String(cause.message || cause), 'error'),
        )
      }, [kind, key, notify])

      const todayWeek = isoWeekKey(state.today)
      const atLatest =
        kind === 'daily' ? key >= state.today : kind === 'weekly' ? key >= todayWeek : key >= state.today.slice(0, 7)

      const periodLabel = kind === 'daily' ? key : kind === 'weekly' ? weekLabel(key) : key

      const periodItems = useMemo(() => {
        const days = state.items.filter((item) => {
          if (item.level !== 'day') return false
          if (kind === 'daily') return item.date === key
          if (kind === 'weekly') return isoWeekKey(item.date) === key
          return item.date.slice(0, 7) === key
        })
        return {
          all: days,
          done: days.filter((item) => item.status === 'done'),
          open: days.filter((item) => item.status !== 'done' && item.status !== 'dropped'),
          hours: round1(days.reduce((sum, item) => sum + (item.status === 'done' ? item.spentH || item.estimateH || 0 : 0), 0)),
        }
      }, [state.items, kind, key])

      const doneGroups = useMemo(() => {
        const groups = new Map()
        for (const item of periodItems.done) {
          const label = planLabel(item, state.items)
          if (!groups.has(label)) groups.set(label, [])
          groups.get(label).push(item)
        }
        return Array.from(groups.entries())
      }, [periodItems.done, state.items])

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(Segmented, {
            value: kind,
            options: [
              { value: 'daily', label: '日报' },
              { value: 'weekly', label: '周报' },
              { value: 'monthly', label: '月报' },
            ],
            onChange: changeKind,
          }),
          h(Btn, { small: true, onClick: () => shift(-1) }, '‹'),
          kind === 'daily'
            ? h(TextInput, {
                type: 'date',
                value: key,
                onChange: setKey,
                width: 150,
              })
            : h('div', { style: { fontSize: 12.5, fontWeight: 600, minWidth: 170 } }, periodLabel),
          h(Btn, { small: true, disabled: atLatest, onClick: () => shift(1) }, '›'),
          h('div', { style: { flex: 1 } }),
          h(Btn, { small: true, onClick: resetDefaults, disabled: busy }, '恢复默认'),
          h(Btn, { small: true, onClick: load, disabled: busy }, busy ? '刷新中…' : '刷新'),
          h(Btn, { small: true, onClick: copy }, '复制'),
          h(Btn, { small: true, onClick: exportFile }, '导出 MD'),
          h(Btn, { small: true, onClick: exportWord }, '导出 Word'),
          kind === 'daily' && report ? h(Btn, { primary: true, onClick: () => setSubmitOpen(true) }, '提交钉钉') : null,
        ),

        h(
          'div',
          cardStyle({ padding: '22px 26px 26px', display: 'flex', flexDirection: 'column', gap: 18 }),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' } },
              kind === 'daily' ? '工作日报' : kind === 'weekly' ? '工作周报' : '工作月报',
            ),
            h('div', { style: { fontSize: 12, color: C.sub, paddingBottom: 3 } }, periodLabel),
            h('div', { style: { flex: 1 } }),
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: C.brand,
                  background: C.brandSoft,
                  padding: '3px 10px',
                  borderRadius: 999,
                },
              },
              '完成 ' + periodItems.done.length + ' / ' + periodItems.all.length + ' · ' + periodItems.hours + 'h',
            ),
          ),

          kind !== 'daily'
            ? h(
                DocSection,
                {
                  title: '一、目标推进 / 小结',
                  hint: '可直接编辑，失焦自动保存',
                  accent: true,
                  extra: h(
                    Btn,
                    { small: true, onClick: () => runAi('goals'), disabled: aiBusy },
                    aiBusy ? '生成中…' : 'AI 生成',
                  ),
                },
                h(InlineArea, {
                  value: goalsText,
                  onChange: setGoalsText,
                  onCommit: () => saveField('goals', goalsText, lastGoals.current, '目标推进'),
                  placeholder: '写这一周/这个月的目标推进情况、关键结论、下阶段重点…',
                }),
              )
            : null,

          h(
            DocSection,
            { title: kind === 'daily' ? '一、今日完成工作' : '二、本期完成', hint: '自动汇总，不可编辑' },
            doneGroups.length === 0
              ? h('div', { style: { fontSize: 12.5, color: C.sub } }, '这段时间还没有已完成的任务')
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                  doneGroups.map(([label, list]) =>
                    h(
                      'div',
                      { key: label },
                      h('div', { style: { fontSize: 11, color: C.sub, marginBottom: 4 } }, label),
                      list.map((item) =>
                        h(
                          'div',
                          {
                            key: item.id,
                            style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0', fontSize: 13 },
                          },
                          h('span', { style: { color: C.ok, fontSize: 11 } }, '✓'),
                          h('span', { style: { flex: 1 } }, item.title),
                          item.spentH || item.estimateH
                            ? h(
                                'span',
                                { style: { fontSize: 11, color: C.sub } },
                                (item.spentH ?? item.estimateH) + 'h',
                              )
                            : null,
                          isWeekend(item.date)
                            ? h('span', { style: { fontSize: 10, color: C.warn } }, '加班')
                            : null,
                        ),
                      ),
                    ),
                  ),
                ),
          ),

          h(
            DocSection,
            {
              title: kind === 'daily' ? '二、所用工时' : '三、所用工时',
              hint: '自动统计，不可编辑',
            },
            h('div', { style: { fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' } }, periodItems.hours + ' h'),
          ),

          h(
            DocSection,
            {
              title: kind === 'daily' ? '三、未完成工作和明天计划' : '四、未完成 / 下一步计划',
              hint: '可直接编辑，失焦自动保存',
              accent: true,
              extra: h(
                Btn,
                { small: true, onClick: () => runAi('left'), disabled: aiBusy },
                aiBusy ? '生成中…' : 'AI 生成',
              ),
            },
            h(InlineArea, {
              value: leftText,
              onChange: setLeftText,
              onCommit: () => saveField('left', leftText, lastLeft.current, '未完成段'),
              placeholder: kind === 'daily' ? '　· 未完成的 xxx\n　· 明日：xxx' : '　· 未完成的 xxx\n　· 下一步：xxx',
            }),
          ),

          h(
            'div',
            {
              style: {
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
                borderTop: '1px solid ' + C.line,
                paddingTop: 10,
                fontSize: 11.5,
                color: C.sub,
              },
            },
            h('span', null, '计划达成 ' + (periodItems.all.filter((item) => item.parentId).length
              ? Math.round(
                  (periodItems.done.filter((item) => item.parentId).length /
                    periodItems.all.filter((item) => item.parentId).length) *
                    100,
                ) + '%'
              : '—')),
            h('span', null, '计划外 ' + periodItems.done.filter((item) => !item.parentId).length + ' 条'),
            h('span', null, report && report.overrides && (report.overrides.left || report.overrides.goals) ? '含手写内容' : '全部自动生成'),
          ),
        ),

        submitOpen && report
          ? h(SubmitModal, { state, report, onClose: () => setSubmitOpen(false), notify })
          : null,
        aiPreview
          ? h(
              Modal,
              {
                title: 'AI 生成的小结',
                width: 560,
                onClose: () => setAiPreview(null),
                footer: h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
                  h(Btn, { onClick: () => setAiPreview(null) }, '取消'),
                  h(Btn, { primary: true, onClick: applyAi }, '替换这段'),
                ),
              },
              h(
                'div',
                { style: { fontSize: 11, color: C.sub } },
                '确认后会替换到「' + (aiPreview.field === 'left' ? '未完成段' : '目标推进') + '」并自动保存；原内容会被覆盖。',
              ),
              h(
                'div',
                {
                  style: {
                    border: '1px solid ' + C.line,
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 13,
                    lineHeight: 1.85,
                    whiteSpace: 'pre-wrap',
                  },
                },
                aiPreview.text,
              ),
            )
          : null,
      )
    }

    function ReportView({ state, notify }) {
      const [kind, setKind] = useState('daily')
      const [key, setKey] = useState(state.today)
      const [report, setReport] = useState(null)
      const [busy, setBusy] = useState(false)
      const [submitOpen, setSubmitOpen] = useState(false)
      const [historyOpen, setHistoryOpen] = useState(false)

      const load = useCallback(async () => {
        setBusy(true)
        try {
          const payload = await call('/report/build', { kind, key })
          setReport(payload.report)
        } catch (cause) {
          notify(String(cause.message || cause), 'error')
        } finally {
          setBusy(false)
        }
      }, [kind, key, notify])

      useEffect(() => {
        load()
      }, [load])

      const changeKind = useCallback(
        (next) => {
          setKind(next)
          setKey(next === 'daily' ? state.today : next === 'weekly' ? isoWeekKey(state.today) : state.today.slice(0, 7))
        },
        [state.today],
      )

      const shift = useCallback(
        (delta) => {
          if (kind === 'daily') setKey(addDays(key, delta))
          else if (kind === 'weekly') setKey(isoWeekKey(addDays(mondayOfWeekKey(key), delta * 7)))
          else setKey(shiftMonth(key, delta))
        },
        [kind, key],
      )

      const copy = useCallback(() => {
        if (!report) return
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(report.markdown).then(
            () => notify('已复制到剪贴板'),
            () => notify('复制失败，请手动选中预览内容复制', 'error'),
          )
        } else {
          notify('当前环境不支持剪贴板，请手动选中复制', 'error')
        }
      }, [report, notify])

      const exportFile = useCallback(() => {
        call('/report/export', { kind, key }).then(
          (payload) => notify('已导出：' + payload.path),
          (cause) => notify('导出失败：' + String(cause.message || cause), 'error'),
        )
      }, [kind, key, notify])

      const label = kind === 'daily' ? key : kind === 'weekly' ? weekLabel(key) : key
      const atLatest =
        kind === 'daily'
          ? key >= state.today
          : kind === 'weekly'
            ? key >= isoWeekKey(state.today)
            : key >= state.today.slice(0, 7)

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(Segmented, {
            value: kind,
            options: [
              { value: 'daily', label: '日报' },
              { value: 'weekly', label: '周报' },
              { value: 'monthly', label: '月报' },
            ],
            onChange: changeKind,
          }),
          h(Btn, { small: true, onClick: () => shift(-1) }, '‹'),
          kind === 'daily'
            ? h('input', {
                type: 'date',
                value: key,
                onChange: (event) => setKey(event.target.value),
                style: inputStyle({ width: 150, padding: '3px 6px', fontSize: 12 }),
              })
            : h('div', { style: { fontSize: 13, fontWeight: 600, minWidth: 190 } }, label),
          h(Btn, { small: true, disabled: atLatest, onClick: () => shift(1) }, '›'),
          h('div', { style: { flex: 1 } }),
          h(Btn, { small: true, onClick: load }, busy ? '刷新中…' : '刷新'),
          h(Btn, { small: true, onClick: copy }, '复制'),
          kind === 'daily' ? h(Btn, { primary: true, onClick: () => setSubmitOpen(true) }, '提交钉钉') : null,
          h(Btn, { small: true, onClick: exportFile }, '导出'),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' } },
          h(
            'div',
            cardStyle({
              flex: '0 0 158px',
              minWidth: 150,
              padding: '10px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 520,
              overflow: 'auto',
            }),
            h('div', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em', padding: '0 4px 6px' } }, '目录'),
            (state.reportIndex || []).length === 0
              ? h('div', { style: { fontSize: 11.5, color: C.sub, padding: '0 4px' } }, '还没有生成过报告')
              : (state.reportIndex || []).map((entry) =>
                  h(
                    'div',
                    {
                      key: entry.id,
                      onClick: () => {
                        setKind(entry.kind)
                        setKey(entry.periodKey)
                      },
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        padding: '5px 6px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: entry.kind === kind && entry.periodKey === key ? C.brandSoft : 'transparent',
                      },
                    },
                    h(
                      'span',
                      { style: { width: 30, color: C.sub, fontSize: 10.5 } },
                      entry.kind === 'daily' ? '日' : entry.kind === 'weekly' ? '周' : '月',
                    ),
                    h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.periodKey),
                    h(
                      'span',
                      {
                        style: {
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: entry.status === 'submitted' ? C.ok : C.track,
                        },
                        title: entry.status === 'submitted' ? '已提交' : '草稿',
                      },
                    ),
                  ),
                ),
          ),
          h(
            'div',
            cardStyle({
              flex: '2 1 460px',
              minWidth: 320,
              padding: '14px 18px',
              minHeight: 240,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, '报告预览'),
              h(
                'span',
                { style: { marginLeft: 'auto', fontSize: 11, color: C.sub } },
                (report ? report.markdown.length : 0) + ' 字',
              ),
            ),
            h('pre', {
              style: {
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: 12.5,
                lineHeight: 1.85,
                color: C.text,
              },
            }, report ? report.markdown : '生成中…'),
          ),
          kind === 'daily' && report
            ? h(LeftEditor, { report, kind, periodKey: key, notify, onSaved: load })
            : null,
          kind === 'daily' && report
            ? h(
                'div',
                cardStyle({
                  flex: '0 1 250px',
                  minWidth: 210,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }),
                h('div', { style: { fontSize: 11, color: C.sub, letterSpacing: '.05em' } }, '提交钉钉的字段'),
                report.fields
                  .filter((field) => field.name !== '未完成工作和明天计划')
                  .map((field) =>
                    h(
                      'div',
                      {
                        key: field.name,
                        style: { borderRadius: 10, padding: '8px 10px', background: C.soft },
                      },
                      h('div', { style: { fontSize: 10.5, color: C.sub } }, field.name),
                      h(
                      'div',
                      {
                        style: {
                          fontSize: 12,
                          whiteSpace: 'pre-wrap',
                          maxHeight: 84,
                          overflow: 'hidden',
                          color: C.text,
                        },
                      },
                      field.content || '（空）',
                    ),
                  ),
                ),
                h(
                  'div',
                  { style: { fontSize: 10.5, color: C.sub, lineHeight: 1.5 } },
                  '「未完成工作和明天计划」在上方框内编辑，这里不再重复；接收人在「插件 → 工作台 → 配置」里设置。',
                ),
              )
            : null,
          kind !== 'daily' ? h(NarrativePanel, { state, kind, periodKey: key, notify, onSaved: load }) : null,
          submitOpen && report
            ? h(SubmitModal, { state, report, onClose: () => setSubmitOpen(false), notify })
            : null,
        ),
      )
    }

    function GitLabConfig() {
      const [loaded, setLoaded] = useState(null)
      const [baseUrl, setBaseUrl] = useState('')
      const [token, setToken] = useState('')
      const [testing, setTesting] = useState(false)
      const [result, setResult] = useState(null)
      const [selected, setSelected] = useState([])
      const [error, setError] = useState('')
      const [saved, setSaved] = useState('')

      useEffect(() => {
        call('/state')
          .then((payload) => {
            setLoaded(payload.state)
            const gitlab = payload.state.connections && payload.state.connections.gitlab
            if (gitlab) {
              setBaseUrl(gitlab.baseUrl || '')
              setSelected(gitlab.projectIds || [])
            }
          })
          .catch((cause) => setError(String(cause.message || cause)))
      }, [])

      const test = useCallback(async () => {
        setTesting(true)
        setError('')
        setSaved('')
        setResult(null)
        try {
          const payload = await call('/gitlab/test', { baseUrl, token })
          setResult(payload.result)
          setSelected((current) =>
            current.length > 0
              ? current
              : payload.result.projects.map((project) => project.id),
          )
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setTesting(false)
        }
      }, [baseUrl, token])

      const save = useCallback(async () => {
        setError('')
        try {
          await call('/gitlab/save', {
            baseUrl,
            token,
            authMode: result ? result.authMode : undefined,
            projectIds: selected,
            projects: result ? result.projects : undefined,
          })
          setSaved('已保存')
          setToken('')
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }, [baseUrl, token, selected, result])

      const gitlab = loaded && loaded.connections && loaded.connections.gitlab
      const projects = result ? result.projects : (gitlab && gitlab.projects) || []

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640, color: C.text, fontSize: 13 } },
        h(
          'div',
          { style: { fontSize: 13, fontWeight: 600 } },
          'GitLab 连接',
        ),
        h(
          'div',
          { style: { fontSize: 12, color: C.sub } },
          gitlab && gitlab.hasToken
            ? '已配置：' + gitlab.baseUrl + '（令牌 ••••' + gitlab.tokenHint + '，已选 ' + (gitlab.projectIds || []).length + ' 个项目）'
            : '尚未配置。填实例地址和个人访问令牌，点「测试连接」即可自动列出你参与的项目。',
        ),
        h(Field, { label: '实例地址' }, h('input', {
          value: baseUrl,
          onChange: (event) => setBaseUrl(event.target.value),
          placeholder: 'http://gitlab.example.com:9091 或 …/api/v4',
          style: inputStyle(),
        })),
        h(Field, { label: gitlab && gitlab.hasToken ? '访问令牌（留空则沿用已保存的）' : '访问令牌' }, h('input', {
          type: 'password',
          value: token,
          onChange: (event) => setToken(event.target.value),
          placeholder: 'glpat-…',
          style: inputStyle(),
        })),
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Btn, { onClick: test, disabled: testing }, testing ? '测试中…' : '测试连接'),
          h(Btn, { primary: true, onClick: save }, '保存'),
          saved ? h('span', { style: { fontSize: 12, color: C.sub, alignSelf: 'center' } }, saved) : null,
        ),
        error
          ? h('div', { style: { color: C.danger, fontSize: 12, whiteSpace: 'pre-wrap' } }, error)
          : null,
        result
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h(
                'div',
                { style: { fontSize: 12 } },
                '已连接：' + (result.user.name || result.user.username) + '（' + result.user.username + '）',
              ),
              result.tokenInfo && result.tokenInfo.changed
                ? h(
                    'div',
                    { style: { fontSize: 12, color: C.sub } },
                    '注意：令牌里含有空白字符，已自动清理（清理后长度 ' + result.tokenInfo.length + '）。',
                  )
                : null,
              h(
                'div',
                { style: { fontSize: 11, color: C.sub } },
                '认证方式：' + (result.authMode === 'bearer' ? 'Authorization: Bearer' : 'PRIVATE-TOKEN') + '（自动探测）',
              ),
              result.tokenType === 'project'
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: 12,
                        color: C.danger,
                        background: C.soft,
                        borderRadius: 6,
                        padding: '8px 10px',
                      },
                    },
                    '⚠️ 这个令牌看起来是「项目访问令牌」（账号形如 project_*_bot）。它通常只能看到所属项目，跨项目查询会失败。若要跨项目，请改用个人访问令牌（scope 至少 read_api）。',
                  )
                : null,
              h('div', { style: { fontSize: 12, color: C.sub } }, '可见项目 ' + result.projects.length + ' 个，勾选要用的：'),
              h(
                'div',
                { style: { maxHeight: 200, overflow: 'auto', border: '1px solid ' + C.line, borderRadius: 8, padding: 8 } },
                projects.length === 0
                  ? h('div', { style: { fontSize: 12, color: C.sub } }, '没有可见项目')
                  : projects.map((project) =>
                      h(
                        'label',
                        {
                          key: project.id,
                          style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' },
                        },
                        h('input', {
                          type: 'checkbox',
                          checked: selected.indexOf(project.id) >= 0,
                          onChange: (event) => {
                            setSelected((current) =>
                              event.target.checked
                                ? current.concat(project.id)
                                : current.filter((id) => id !== project.id),
                            )
                          },
                        }),
                        h('span', { style: { flex: 1 } }, project.pathWithNamespace || project.name),
                        h('span', { style: { fontSize: 11, color: C.sub } }, String(project.id)),
                      ),
                    ),
              ),
            )
          : null,
        h(
          'div',
          { style: { fontSize: 11, color: C.sub } },
          '令牌以明文保存在本机 profile 的数据文件里；这是个人单机工具，别把它放在共享机器上。',
        ),
        loaded
          ? h(
              'div',
              { style: { fontSize: 11, color: C.sub } },
              '数据文件：' + (loaded.dataFile || ''),
            )
          : null,
      )
    }

    function DingTalkConfig() {
      const [status, setStatus] = useState(null)
      const [templates, setTemplates] = useState([])
      const [templateId, setTemplateId] = useState('')
      const [fields, setFields] = useState([])
      const [mapping, setMapping] = useState({ done: '', hours: '', left: '', risks: '' })
      const [recipients, setRecipients] = useState([])
      const [query, setQuery] = useState('')
      const [candidates, setCandidates] = useState([])
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [saved, setSaved] = useState('')

      const loadTemplate = useCallback(
        async (name) => {
          try {
            const payload = await call('/dws/template', { name })
            setFields(payload.template.fields)
            setTemplateId(payload.template.id)
            setMapping((current) => {
              const pick = (want, fallbackType) => {
                if (current[want] && payload.template.fields.some((field) => field.name === current[want])) {
                  return current[want]
                }
                const hit = payload.template.fields.find((field) =>
                  fallbackType ? field.type === fallbackType : field.name.indexOf(want) >= 0,
                )
                return hit ? hit.name : ''
              }
              return {
                done: payload.template.fields.some((f) => f.name === current.done)
                  ? current.done
                  : (payload.template.fields.find((f) => f.name === '今日完成工作') || {}).name || '',
                hours: payload.template.fields.some((f) => f.name === current.hours)
                  ? current.hours
                  : (payload.template.fields.find((f) => f.type === 2) || {}).name || '',
                left: payload.template.fields.some((f) => f.name === current.left)
                  ? current.left
                  : (payload.template.fields.find((f) => f.name === '未完成工作和明天计划') || {}).name || '',
                risks: payload.template.fields.some((f) => f.name === current.risks)
                  ? current.risks
                  : (payload.template.fields.find((f) => f.name === '需协调工作') || {}).name || '',
              }
            })
          } catch (cause) {
            setError(String(cause.message || cause))
          }
        },
        [],
      )

      useEffect(() => {
        let alive = true
        Promise.all([call('/state'), call('/dws/status'), call('/dws/templates')])
          .then(([statePayload, statusPayload, templatePayload]) => {
            if (!alive) return
            const ding = (statePayload.state.settings && statePayload.state.settings.dingtalk) || {}
            setStatus(statusPayload.status)
            setTemplates(templatePayload.templates)
            setTemplateId(ding.templateId || '')
            setFields(ding.fields || [])
            setMapping(ding.mapping || { done: '', hours: '', left: '', risks: '' })
            setRecipients(ding.recipients || [])
            if (ding.templateName && (!ding.fields || ding.fields.length === 0)) loadTemplate(ding.templateName)
          })
          .catch((cause) => alive && setError(String(cause.message || cause)))
        return () => {
          alive = false
        }
      }, [loadTemplate])

      const searchPeople = useCallback(async () => {
        if (!query.trim()) return
        setBusy(true)
        setError('')
        try {
          const payload = await call('/dws/people', { query: query.trim() })
          setCandidates(payload.people)
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy(false)
        }
      }, [query])

      const save = useCallback(async () => {
        setBusy(true)
        setError('')
        try {
          const current = templates.find((item) => item.id === templateId)
          await call('/dws/config', {
            templateId,
            templateName: current ? current.name : '',
            fields,
            mapping,
            recipients,
          })
          setSaved('已保存')
        } catch (cause) {
          setError(String(cause.message || cause))
        } finally {
          setBusy(false)
        }
      }, [templates, templateId, fields, mapping, recipients])

      const textFields = fields.filter((field) => field.type === 1 || field.type === 2)

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720, color: C.text, fontSize: 13 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, '钉钉日志'),
        h(
          'div',
          { style: { fontSize: 12, color: C.sub } },
          status
            ? status.authenticated && status.tokenValid
              ? '已登录：' + status.userName + '（' + status.corpName + '）· 令牌有效期至 ' + String(status.expiresAt).replace('T', ' ').slice(0, 19)
              : '未登录或令牌已失效，请在终端运行 dws auth login --recommend 后刷新'
            : '正在检测登录态…',
        ),
        h(Field, { label: '日志模板' }, h(
          'select',
          {
            value: templateId,
            onChange: (event) => {
              const next = templates.find((item) => item.id === event.target.value)
              setTemplateId(event.target.value)
              if (next) loadTemplate(next.name)
            },
            style: inputStyle(),
          },
          h('option', { value: '' }, '选择模板…'),
          templates.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
        )),
        fields.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: { fontSize: 12, color: C.sub } }, '字段映射（报告段落 → 钉钉字段）'),
              [
                { key: 'done', label: '今日完成' },
                { key: 'hours', label: '所用工时' },
                { key: 'left', label: '未完成 / 明天计划' },
                { key: 'risks', label: '需协调工作' },
              ].map((row) =>
                h(
                  'div',
                  { key: row.key, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
                  h('span', { style: { width: 120, color: C.sub } }, row.label),
                  h(
                    'select',
                    {
                      value: mapping[row.key] || '',
                      onChange: (event) => setMapping({ ...mapping, [row.key]: event.target.value }),
                      style: inputStyle({ flex: 1 }),
                    },
                    h('option', { value: '' }, '（不填）'),
                    textFields.map((field) => h('option', { key: field.name, value: field.name }, field.name)),
                  ),
                ),
              ),
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: { fontSize: 12, color: C.sub } }, '日志接收人（提交时发送到这些人）'),
          h(
            'div',
            { style: { display: 'flex', gap: 8 } },
            h('input', {
              value: query,
              onChange: (event) => setQuery(event.target.value),
              placeholder: '输入姓名后搜索',
              style: inputStyle({ flex: 1 }),
              onKeyDown: (event) => {
                if (event.key === 'Enter') searchPeople()
              },
            }),
            h(Btn, { onClick: searchPeople, disabled: busy }, '搜索'),
          ),
          candidates.length > 0
            ? h(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                candidates.map((person) =>
                  h(
                    Btn,
                    {
                      key: person.userId,
                      small: true,
                      onClick: () => {
                        if (!recipients.some((item) => item.userId === person.userId)) {
                          setRecipients(recipients.concat(person))
                        }
                        setCandidates([])
                        setQuery('')
                      },
                    },
                    '+ ' + person.name,
                  ),
                ),
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            recipients.length === 0
              ? h('span', { style: { fontSize: 12, color: C.danger } }, '还没选接收人 —— 不选的话日志提交后对任何人都不可见')
              : recipients.map((person) =>
                  h(
                    'span',
                    {
                      key: person.userId,
                      style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: C.soft,
                        fontSize: 12,
                      },
                    },
                    person.name + '（' + person.userId + '）',
                    h(
                      'button',
                      {
                        onClick: () => setRecipients(recipients.filter((item) => item.userId !== person.userId)),
                        style: { border: 'none', background: 'transparent', cursor: 'pointer', color: C.sub },
                      },
                      '×',
                    ),
                  ),
                ),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(Btn, { primary: true, onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
          saved ? h('span', { style: { fontSize: 12, color: C.sub, alignSelf: 'center' } }, saved) : null,
        ),
        error ? h('div', { style: { color: C.danger, fontSize: 12, whiteSpace: 'pre-wrap' } }, error) : null,
      )
    }

    function BundleConfig() {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 30, padding: '4px 2px' } },
        h(GitLabConfig),
        h(DingTalkConfig),
      )
    }

    function SettingsPanel({ state, mutate, onClose, notify }) {
      const [root, setRoot] = useState((state.settings && state.settings.exportRoot) || '')
      const initialSchedule = (state.settings && state.settings.schedule) || {}
      const [scheduleEnabled, setScheduleEnabled] = useState(initialSchedule.enabled !== false)
      const [probe, setProbe] = useState(null)
      const [probing, setProbing] = useState(false)
      const [weekdayTime, setWeekdayTime] = useState(initialSchedule.weekdayTime || '18:00')
      const [fridayTime, setFridayTime] = useState(initialSchedule.fridayTime || '18:00')
      const [weeklyOnFriday, setWeeklyOnFriday] = useState(initialSchedule.weeklyOnFriday !== false)
      const [holidaysText, setHolidaysText] = useState(
        ((state.settings && state.settings.holidays) || []).map((entry) => entry.date + ' ' + entry.kind).join('\n'),
      )

      const parseHolidays = (text) =>
        String(text || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(/\s+/)
            const date = parts[0]
            const kind = (parts[1] || 'off').toLowerCase() === 'on' ? 'on' : 'off'
            return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, kind } : null
          })
          .filter(Boolean)
      return h(
        Modal,
        {
          title: '设置',
          onClose,
          footer: h(
            'div',
            { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
            h(Btn, { onClick: onClose }, '取消'),
            h(
              Btn,
              {
                primary: true,
                onClick: () =>
                  mutate('/settings/save', {
                    exportRoot: root,
                    holidays: parseHolidays(holidaysText),
                    schedule: {
                      enabled: scheduleEnabled,
                      weekdayTime,
                      fridayTime,
                      weeklyOnFriday,
                    },
                  }).then(
                    () => {
                      notify('已保存设置')
                      onClose()
                    },
                    (cause) => notify(String(cause.message || cause), 'error'),
                  ),
              },
              '保存',
            ),
          ),
        },
        h(Field, { label: '导出根目录（留空则用 profile 下的 worklog/exports）' }, h('input', {
          value: root,
          onChange: (event) => setRoot(event.target.value),
          placeholder: 'D:\\work\\worklog',
          style: inputStyle(),
        })),
        h(
          'div',
          { style: { borderTop: '1px solid ' + C.line, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 } },
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
            h('input', {
              type: 'checkbox',
              checked: scheduleEnabled,
              onChange: (event) => setScheduleEnabled(event.target.checked),
            }),
            '启用定时生成草稿（软件开着才会执行；开机后补当天）',
          ),
          h(
            'div',
            { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
            h(Field, { label: '周一至周四 生成日报', grow: true }, h('input', {
              type: 'time',
              value: weekdayTime,
              onChange: (event) => setWeekdayTime(event.target.value),
              style: inputStyle(),
            })),
            h(Field, { label: '周五 生成日报', grow: true }, h('input', {
              type: 'time',
              value: fridayTime,
              onChange: (event) => setFridayTime(event.target.value),
              style: inputStyle(),
            })),
          ),
          h(
            'label',
            { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 } },
            h('input', {
              type: 'checkbox',
              checked: weeklyOnFriday,
              onChange: (event) => setWeeklyOnFriday(event.target.checked),
            }),
            '周五同时生成周报草稿',
          ),
          h(
            'div',
            { style: { fontSize: 11, color: C.sub } },
            '到点后生成草稿并在工作台顶部提示，不会自动发到钉钉。',
          ),
          h(
            Field,
            { label: '节假日 / 调休（每行一条：日期 off=放假 on=调休上班）' },
            h('textarea', {
              value: holidaysText,
              rows: 4,
              onChange: (event) => setHolidaysText(event.target.value),
              placeholder: '2026-01-01 off\n2026-02-08 on',
              style: inputStyle({ resize: 'vertical', fontFamily: 'inherit', minHeight: 84 }),
            }),
            h(
              'div',
              { style: { fontSize: 10.5, color: C.sub } },
              '用于判断加班：周末与非工作日算加班，标记 on 的周末不算。',
            ),
          ),
          h(
            Btn,
            {
              small: true,
              onClick: () =>
                mutate('/settings/save', {
                  exportRoot: root,
                  holidays: parseHolidays(holidaysText),
                  schedule: { enabled: scheduleEnabled, weekdayTime, fridayTime, weeklyOnFriday },
                })
                  .then(() => call('/schedule/run', {}))
                  .then(
                    (payload) =>
                      notify(
                        payload && payload.created > 0
                          ? '已保存，并生成 ' + payload.created + ' 份草稿'
                          : '已保存；今天已生成过草稿，未重复生成',
                      ),
                    (cause) => notify(String(cause.message || cause), 'error'),
                  ),
            },
            '保存并立即试跑',
          ),
          h(
            Btn,
            {
              small: true,
              disabled: probing,
              onClick: () => {
                setProbing(true)
                setProbe(null)
                call('/dws/selftest', {})
                  .then((payload) => {
                    setProbe(payload)
                    notify(payload.allOk ? '钉钉链路正常' : '钉钉链路有问题，见下方明细', payload.allOk ? undefined : 'error')
                  })
                  .catch((cause) => notify(String(cause.message || cause), 'error'))
                  .finally(() => setProbing(false))
              },
            },
            probing ? '检测中…' : '测试钉钉连通性',
          ),
          probe
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 } },
                (probe.steps || []).map((step) =>
                  h(
                    'div',
                    { key: step.name, style: { display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' } },
                    h('span', { style: { color: step.ok ? C.ok : C.danger } }, step.ok ? '✓' : '✕'),
                    h('span', { style: { width: 120, color: C.sub } }, step.name),
                    h('span', { style: { flex: 1, whiteSpace: 'pre-wrap' } }, step.detail),
                  ),
                ),
              )
            : null,
        ),
        h('div', { style: { fontSize: 11, color: C.sub } }, '数据文件：' + (state.dataFile || '')),
      )
    }

    // ---------------- root ----------------

    function ToastHost({ toasts }) {
      if (!toasts || toasts.length === 0) return null
      return h(
        'div',
        {
          style: {
            position: 'fixed',
            zIndex: 120,
            top: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            pointerEvents: 'none',
          },
        },
        h('style', null, '@keyframes wbToastIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}'),
        toasts.map((toast) =>
          h(
            'div',
            {
              key: toast.id,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '10px 15px',
                borderRadius: 12,
                background: C.panel,
                boxShadow: '0 12px 36px rgba(0,0,0,.22), 0 2px 6px rgba(0,0,0,.08)',
                borderLeft: '3px solid ' + (toast.type === 'error' ? C.danger : C.ok),
                fontSize: 12.5,
                color: C.text,
                maxWidth: 'min(560px, 80vw)',
                animation: 'wbToastIn .16s ease-out',
              },
            },
            h(
              'span',
              { style: { color: toast.type === 'error' ? C.danger : C.ok, fontSize: 13, lineHeight: 1 } },
              toast.type === 'error' ? '✕' : '✓',
            ),
            h('span', { style: { whiteSpace: 'pre-wrap' } }, toast.message),
          ),
        ),
      )
    }

    function Workbench() {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [toasts, setToasts] = useState([])
      const [tab, setTab] = useState('today')
      const [form, setForm] = useState(null)
      const [settingsOpen, setSettingsOpen] = useState(false)
      const [themeName, setThemeName] = useState(() => {
        try {
          const saved = window.localStorage.getItem('wb-theme')
          return saved && THEMES[saved] ? saved : 'emerald'
        } catch (error) {
          return 'indigo'
        }
      })

      const reload = useCallback(async () => {
        try {
          const payload = await call('/state')
          setState(payload.state)
          setError('')
        } catch (cause) {
          setError(String(cause.message || cause))
        }
      }, [])

      useEffect(() => {
        reload()
      }, [reload])

      const mutate = useCallback(async (action, body) => {
        const payload = await call(action, body)
        if (payload.state) setState(payload.state)
        return payload
      }, [])

      const notify = useCallback((message, type) => {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
        setToasts((current) => current.concat({ id, message: String(message), type: type || 'ok' }))
        window.setTimeout(() => {
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }, 3400)
      }, [])

      const openForm = useCallback((initial) => setForm({ initial }), [])
      const closeForm = useCallback(() => setForm(null), [])
      const onSave = useCallback((payload) => mutate('/item/save', payload).then((result) => result.item), [mutate])
      const onSync = useCallback((body) => mutate('/gitlab/sync', body), [mutate])

      if (!state) {
        return h('div', { style: { padding: 28, color: C.sub, fontSize: 13 } }, error ? '工作台读取失败：' + error : '加载中…')
      }

      return h(
        'div',
        {
          style: Object.assign(
            {
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              color: C.text,
              fontSize: 13,
              lineHeight: 1.55,
            },
            themeVars(THEMES[themeName] || THEMES.emerald),
          ),
        },
        h(
          'div',
          { style: { flex: '0 0 auto', padding: '10px 20px 0' } },
          h(
            'div',
            {
              style: {
                maxWidth: 980,
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                padding: '8px 12px',
                borderRadius: 14,
                background: 'linear-gradient(120deg, ' + C.brandSoft + ', transparent 62%)',
              },
            },
            h('div', { style: { fontSize: 16, fontWeight: 700, letterSpacing: '-.01em' } }, '工作台'),
            h('div', { style: { color: C.sub, fontSize: 11.5 } }, state.today),
            h(Segmented, {
              value: tab,
              options: [
                { value: 'today', label: '今日' },
                { value: 'plan', label: '计划' },
                { value: 'stats', label: '统计' },
                { value: 'report', label: '报告' },
              ],
              onChange: setTab,
            }),
            h('div', { style: { flex: 1 } }),
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              Object.keys(THEMES).map((key) =>
                h('button', {
                  key,
                  title: '配色：' + THEMES[key].name,
                  onClick: () => {
                    setThemeName(key)
                    try {
                      window.localStorage.setItem('wb-theme', key)
                    } catch (error) {
                      // 忽略
                    }
                  },
                  style: {
                    width: 15,
                    height: 15,
                    padding: 0,
                    borderRadius: 999,
                    cursor: 'pointer',
                    border: themeName === key ? '2px solid ' + C.text : '2px solid transparent',
                    background: 'linear-gradient(135deg, ' + THEMES[key].accent + ', ' + THEMES[key].accent2 + ')',
                  },
                }),
              ),
            ),
            h(Btn, { small: true, onClick: () => setSettingsOpen(true) }, '设置'),
            h(Btn, { small: true, onClick: reload }, '刷新'),
          ),
        ),
        h(
          'div',
          { style: { flex: '1 1 auto', overflow: 'auto', padding: '12px 20px 28px' } },
          h(
            'div',
            { style: { maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 } },
            error ? h('div', { style: { color: C.danger, fontSize: 12 } }, '读取失败：' + error) : null,
          state.drafts && state.drafts.length > 0
            ? h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: C.soft,
                    fontSize: 12,
                  },
                },
                h(
                  'span',
                  { style: { flex: 1 } },
                  '定时草稿已生成：' +
                    state.drafts
                      .map((draft) =>
                        (draft.kind === 'daily' ? '日报 ' : draft.kind === 'weekly' ? '周报 ' : '月报 ') +
                        draft.periodKey,
                      )
                      .join('、'),
                ),
                h(Btn, { small: true, onClick: () => setTab('report') }, '去查看'),
                h(
                  Btn,
                  {
                    small: true,
                    onClick: () => {
                      Promise.all(state.drafts.map((draft) => call('/report/ack', { id: draft.id }))).then(reload)
                    },
                  },
                  '忽略',
                ),
              )
            : null,
          tab === 'today'
            ? h(TodayView, { state, mutate, openForm, notify })
            : tab === 'plan'
              ? h(PlanView, { state, mutate, openForm, notify })
              : tab === 'stats'
                ? h(StatsPage, { state })
                : h(ReportDoc, { state, notify }),
          form ? h(TaskForm, { state, initial: form.initial, onClose: closeForm, onSave, onSync, notify }) : null,
          settingsOpen ? h(SettingsPanel, { state, mutate, onClose: () => setSettingsOpen(false), notify }) : null,
          ),
        ),
        h(ToastHost, { toasts }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'workbench', order: 20, label: '工作台' }, Icon),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'workbench' }, Workbench))
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            { name: 'plugins.row.config', key: '@local/dsh-workbench#workbench' },
            BundleConfig,
          ),
        )
      },
    }
  },
})
