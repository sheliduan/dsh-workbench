#Requires -Version 5.1
<#
  诊断 GitLab 令牌：判断 401 是令牌本身的问题，还是插件的问题。
  用法：
    powershell -ExecutionPolicy Bypass -File D:\dsh-workbench\diagnose-gitlab.ps1 -Token "glpat-xxxx"
  可选：
    -BaseUrl "http://gitlab.example.com:9091"
  脚本不会打印令牌内容，只打印长度、是否含空白字符、以及每种认证方式的状态码与响应体。
#>
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$BaseUrl = 'http://gitlab.example.com:9091'
)

$ErrorActionPreference = 'Stop'
$api = $BaseUrl.TrimEnd('/')
if ($api -notmatch '/api/v4$') { $api = $api + '/api/v4' }
$url = "$api/user"

Write-Output "==== 令牌自检 ===="
$raw = $Token
$clean = ($raw -replace '[\s\u200B-\u200D\uFEFF]', '')
Write-Output ("原始长度      : " + $raw.Length)
Write-Output ("去空白后长度  : " + $clean.Length)
Write-Output ("含空白/不可见 : " + ($raw -ne $clean))
Write-Output ("前缀是否 glpat: " + $clean.StartsWith('glpat-'))
Write-Output ("末 4 位       : ****" + $clean.Substring([Math]::Max(0, $clean.Length - 4)))

Write-Output ""
Write-Output "==== 目标地址 ===="
try {
  $ip = [System.Net.Dns]::GetHostAddresses(([System.Uri]$api).Host) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | Select-Object -First 1
  Write-Output ("解析到        : " + $ip)
} catch {
  Write-Output ("解析失败      : " + $_.Exception.Message)
}
Write-Output ("请求 URL      : " + $url)

function Try-Mode {
  param([string]$Name, [string[]]$Headers, [string]$Suffix = '')
  Write-Output ""
  Write-Output "==== $Name ===="
  $curlArgs = @('-s', '-i', '--max-time', '15')
  foreach ($h in $Headers) { $curlArgs += @('-H', $h) }
  $curlArgs += ($url + $Suffix)
  $out = & curl.exe @curlArgs 2>&1
  $status = ($out | Select-String -Pattern '^HTTP/' | Select-Object -First 1).Line
  Write-Output ("状态行 : " + $status)
  $body = $out | Select-String -Pattern '^\s*\{' | Select-Object -First 1
  Write-Output ("响应体 : " + $body)
}

Try-Mode -Name 'PRIVATE-TOKEN 头' -Headers @("PRIVATE-TOKEN: $clean")
Try-Mode -Name 'Authorization: Bearer' -Headers @("Authorization: Bearer $clean")
Try-Mode -Name 'query 参数 private_token' -Headers @() -Suffix ("?private_token=" + $clean)

Write-Output ""
Write-Output "==== 结论怎么看 ===="
Write-Output "三种方式都 401 → 令牌在这台机器上被 GitLab 拒绝，与插件无关。"
Write-Output "  下一步排查：令牌是否已吊销、令牌是否属于这个实例、实例或前置 WAF 是否限制了来源 IP。"
Write-Output "  可对比：GitLab 网页里该令牌「最近使用的 IP」列出的地址，与本机 IP 是否同一网段。"
Write-Output "任一方式 200 → 是插件的请求方式问题，把这段输出发我，我按状态行修。"
