# install-git.ps1 —— 给 DSH 装插件用：把 git 自动装好，并让 DSH 能看见它
#
# 为什么需要它：
#   DSH 装插件走 `git ls-remote` 检查仓库，再调 pnpm add。
#   **git 不在 PATH 里，那一步就当场失败**，报 `'git' 不是内部或外部命令`。
#   而 DSH 是打包好的 app.asar，装插件的逻辑改不了 —— 所以只能在这台机器上把 git 补齐。
#
# 它做四件事：
#   1. 找 git（PATH 里 / 常见安装目录 / 便携版）
#   2. 找不到就装（winget 优先；没有 winget 就退到便携版 7z 自解压包）
#   3. 把它加进**用户级 PATH**（不需要管理员权限）
#   4. 提醒你重启 DSH —— 这一步不能省，见下
#
# ⚠️ **装完必须彻底退出 DSH 再重开。**
#    进程的 PATH 是**启动那一刻**的快照。今天实测过一台机器：
#    机器级 PATH 里明明写着 C:\Program Files\Git\cmd，DSH 里的 pnpm 仍然报"不是内部或外部命令"。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install-git.ps1
#   加 -Force 可以强制重装

param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Write-Warn2($t){ Write-Host "  [!!]   $t" -ForegroundColor Yellow }
function Write-Bad($t)  { Write-Host "  [XX]   $t" -ForegroundColor Red }

# ---------- 1. 找 git ----------
Write-Step "1/4 找 git"

$candidates = @()
$onPath = Get-Command git -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }

$candidates += @(
  "$env:ProgramFiles\Git\cmd\git.exe"
  "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  "$env:USERPROFILE\scoop\shims\git.exe"
  "$env:ProgramData\chocolatey\bin\git.exe"
  "$PSScriptRoot\portablegit\cmd\git.exe"
) | Where-Object { $_ }

$git = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path $c)) { $git = $c; break }
}

if ($git -and -not $Force) {
  $ver = & $git --version 2>$null
  Write-Ok "已经有 git：$git"
  Write-Ok "版本：$ver"
} else {
  if ($git) { Write-Warn2 "-Force 指定了，重装" } else { Write-Warn2 "没找到 git，准备安装" }

  # ---------- 2. 装 git ----------
  Write-Step "2/4 装 git"

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "  用 winget 装 Git.Git（约 60 MB，可能要几分钟）"
    try {
      & winget install --id Git.Git -e --silent `
        --accept-package-agreements --accept-source-agreements 2>&1 |
        Select-Object -Last 4 | ForEach-Object { Write-Host "    $_" }
      Write-Ok "winget 完成"
    } catch {
      Write-Warn2 "winget 失败：$($_.Exception.Message)"
    }
    # winget 装完刷新一次本进程的 PATH，再看得到看不到
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path','User')
    $onPath = Get-Command git -ErrorAction SilentlyContinue
    if ($onPath) { $git = $onPath.Source }
    if (-not $git) {
      foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $git = $c; break } }
    }
  } else {
    Write-Warn2 "这台机器没有 winget —— 退到便携版"
  }

  # 兜底：下载 PortableGit（7z 自解压，静默解压，不需要管理员）
  if (-not $git) {
    Write-Host "  下载 PortableGit（约 60 MB）"
    $zip = Join-Path $env:TEMP 'PortableGit.7z.exe'
    $dest = Join-Path $PSScriptRoot 'portablegit'
    $url = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/PortableGit-2.56.0-64-bit.7z.exe'
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      Write-Host "  解压到 $dest"
      Start-Process -FilePath $zip -ArgumentList "-o`"$dest`" -y" -Wait -NoNewWindow
      if (Test-Path (Join-Path $dest 'cmd\git.exe')) { $git = Join-Path $dest 'cmd\git.exe' }
      Write-Ok "便携版就位"
    } catch {
      Write-Bad "便携版也失败了：$($_.Exception.Message)"
    }
  }
}

if (-not $git) {
  Write-Bad "没能装上 git。请手动装一个：https://git-scm.com/download/win"
  Write-Host "  或者不碰 git：用 dsh-mood Release 里的 dsh-mood-pack.zip 手动解压进 node_modules"
  exit 1
}

Write-Ok "git = $git"
& $git --version

# ---------- 3. 加进用户级 PATH ----------
Write-Step "3/4 加进用户级 PATH"

$dir = Split-Path (Split-Path $git -Parent) -Parent
$cmdDir = Join-Path $dir 'cmd'
if (-not (Test-Path $cmdDir)) { $cmdDir = Split-Path $git -Parent }

$userPath = [Environment]::GetEnvironmentVariable('Path','User')
if (-not $userPath) { $userPath = '' }
$parts = $userPath -split ';' | Where-Object { $_ }

if ($parts -contains $cmdDir) {
  Write-Ok "已经在用户级 PATH 里：$cmdDir"
} else {
  $newPath = (($parts + $cmdDir) -join ';')
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Ok "已加进用户级 PATH：$cmdDir"
  Write-Host "  （只改用户级，不需要管理员；也不动机器级）"
}

# ---------- 4. 验证 + 提醒重启 ----------
Write-Step "4/4 验证"
Write-Host "  用户级 PATH 里现在有："
([Environment]::GetEnvironmentVariable('Path','User') -split ';' |
  Where-Object { $_ -match 'Git' }) | ForEach-Object { Write-Host "    $_" }

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Yellow
Write-Host "  ⚠️ 现在请**彻底退出 DSH 再重开**（托盘也要退）" -ForegroundColor Yellow
Write-Host "     进程的 PATH 是启动那一刻的快照 —— 不重启，DSH 里还是找不到 git。" -ForegroundColor Yellow
Write-Host "     重开之后，再去插件面板点「重试」。" -ForegroundColor Yellow
Write-Host "  ============================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  验证：新开一个 cmd，敲  git --version  能出版本号就算通。" -ForegroundColor Gray
Write-Host ""
Write-Host "  ⚠️ 另一条路（完全不需要 git）：" -ForegroundColor Gray
Write-Host "     用 Release 里的 dsh-mood-pack.zip 解压进 node_modules" -ForegroundColor Gray
Write-Host "     或者  pnpm add <release 里的 .tgz 直链>" -ForegroundColor Gray
