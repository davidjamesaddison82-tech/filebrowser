# Shared settings and helpers for the HarmonyByrd HQ Windows scripts. Dot-sourced, not run.
# Windows PowerShell 5.1 compatible. ASCII only. No passwords or tokens anywhere in these scripts.

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'   # make wsl.exe print readable text

$HQDistro      = 'HarmonyByrdHQ'
$HQHome        = Join-Path $env:USERPROFILE 'HarmonyByrdHQ'
$HQSystemDir   = Join-Path $HQHome 'System'      # the WSL disk: PostgreSQL data and the application
$HQBackupDir   = Join-Path $HQHome 'Backups'     # nightly and on-stop backups (plain pg_dump files)
$HQArchiveDir  = Join-Path $HQHome 'Archive'     # the preservation archive and its unpacked originals
$HQProgramDir  = Join-Path $HQHome 'Program'     # these scripts, the launchers, the release archive
$HQLogDir      = Join-Path $HQHome 'Logs'
$HQPort        = 3210
$HQUrl         = "http://localhost:$HQPort"

$PreservationName   = 'hq-preservation-2026-11-21-v1.zip'
$PreservationSha256 = 'c752592b3e8d8980df5685aa993f8ac03a6eaea308da479c9739d7949f21301e'
$PreservationFolder = 'hq-preservation-2026-11-21-v1'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)   { Write-Host "   OK  $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "   !!  $Text" -ForegroundColor Yellow }
function Stop-WithMessage([string]$Text) {
  Write-Host ''
  Write-Host $Text -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close'
  exit 1
}

function Test-HQDistro {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
  if (-not (Test-Path $key)) { return $false }
  foreach ($d in Get-ChildItem $key) {
    $p = Get-ItemProperty $d.PSPath
    if ($p.DistributionName -eq $HQDistro) { return $true }
  }
  return $false
}

function Assert-HQInstalled {
  if (-not (Test-HQDistro)) {
    Stop-WithMessage "HarmonyByrd HQ is not installed on this computer. Run 'Install HarmonyByrd HQ' first."
  }
}

# C:\Users\me\x -> /mnt/c/Users/me/x (the default WSL mount of Windows drives).
function ConvertTo-WslPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $drive = $full.Substring(0, 1).ToLower()
  return '/mnt/' + $drive + ($full.Substring(2) -replace '\\', '/')
}

# Run a program inside the HQ distribution as root, without a shell (arguments pass through as given).
# Output goes straight to the window. Returns the exit code.
function Invoke-HQ {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Command)
  # Out-Host keeps the program's output on screen instead of in this function's return value.
  & wsl.exe -d $HQDistro -u root -e @Command | Out-Host
  return $LASTEXITCODE
}

# Run wsl.exe with its output hidden; returns the exit code. (Windows PowerShell 5.1 would otherwise
# treat anything wsl.exe prints on its error stream as a fatal error while output is redirected.)
function Invoke-WslQuiet {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & wsl.exe @Arguments *> $null; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
  return $code
}

function Get-KeepAlive {
  Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*hq-keepalive*' }
}

function Test-HQAnswering {
  try {
    $r = Invoke-WebRequest -Uri "$HQUrl/api/v1/health" -UseBasicParsing -TimeoutSec 5
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

# Start the distribution (systemd then starts PostgreSQL and HQ), keep it running, wait until HQ answers.
function Start-HQServices {
  if (-not (Get-KeepAlive)) {
    Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $HQDistro, '-u', 'root', '-e', '/usr/local/bin/hq-keepalive') -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
  [void](Invoke-HQ systemctl start postgresql hq)
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-HQAnswering) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Listening sockets for HQ's ports on the Windows side must be loopback only.
# Port 3210 is HQ's whatever owns it; 5432 counts only when WSL forwards it (a PostgreSQL of your own
# installed directly on Windows is not part of HQ).
function Get-ExposedListeners {
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -ne '127.0.0.1' -and $_.LocalAddress -ne '::1' } |
    Where-Object {
      if ($_.LocalPort -eq $HQPort) { return $true }
      if ($_.LocalPort -ne 5432) { return $false }
      $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
      return ($p -and $p.ProcessName -like 'wsl*')
    }
}

# Verify the unpacked preservation archive against its own SHA256SUMS. Returns the number of bad files.
function Test-ArchiveIntegrity {
  $root = Join-Path $HQArchiveDir $PreservationFolder
  $sums = Join-Path $root 'SHA256SUMS'
  if (-not (Test-Path $sums)) { Write-Warn "Archive not found at $root"; return 1 }
  $bad = 0; $n = 0
  foreach ($line in Get-Content -LiteralPath $sums) {
    if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
    $want = $Matches[1]; $rel = $Matches[2] -replace '^\./', ''
    $file = Join-Path $root ($rel -replace '/', '\')
    $n++
    if (-not (Test-Path -LiteralPath $file)) { Write-Warn "missing: $rel"; $bad++; continue }
    $got = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $want) { Write-Warn "changed: $rel"; $bad++ }
  }
  $originals = @(Get-ChildItem -LiteralPath (Join-Path $root 'recovery\captured-originals') -Recurse -File |
    Where-Object { $_.Name -ne 'SOURCE-MAP.txt' }).Count
  if ($bad -eq 0) { Write-Ok "Archive: all $n files match their SHA-256 checksums ($originals captured original documents)" }
  return $bad
}
