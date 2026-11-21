# HarmonyByrd HQ - Windows installer. Started by "Install HarmonyByrd HQ.cmd".
# Safe to run again: a second run updates the application and never replaces the database.
param([string]$PreservationPath = '')

. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
$PackageRoot = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host '  HarmonyByrd HQ - installation on this computer' -ForegroundColor White
Write-Host '  ----------------------------------------------'
Write-Host '  HQ will run only on this computer. Nothing is uploaded anywhere.'
Write-Host '  It downloads Ubuntu Linux, PostgreSQL 16 and Node.js (public software) the first time.'
Write-Host '  Allow 20-40 minutes. Keep this window open.'

New-Item -ItemType Directory -Force -Path $HQHome, $HQBackupDir, $HQArchiveDir, $HQProgramDir, $HQLogDir | Out-Null
$log = Join-Path $HQLogDir ("install-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $log -Append | Out-Null

# Files downloaded from the internet are marked by Windows; unmark ours so they run without warnings.
Get-ChildItem -LiteralPath $PackageRoot -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- 1. Check this package
Write-Step '1. Checking the installation package'
$sumsFile = Join-Path $PackageRoot 'SHA256SUMS.txt'
if (-not (Test-Path $sumsFile)) { Stop-WithMessage 'SHA256SUMS.txt is missing from the installation package. Download it again.' }
foreach ($line in Get-Content -LiteralPath $sumsFile) {
  if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
  $want = $Matches[1]; $rel = $Matches[2]
  $f = Join-Path $PackageRoot ($rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $f)) { Stop-WithMessage "The package is incomplete: $rel is missing." }
  if ((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower() -ne $want) { Stop-WithMessage "The package is damaged: $rel does not match its checksum. Download it again." }
}
$releaseZip = Get-ChildItem -LiteralPath (Join-Path $PackageRoot 'payload') -Filter 'harmonybyrd-hq-release-*.zip' | Select-Object -First 1
if (-not $releaseZip) { Stop-WithMessage 'The HQ application archive is missing from the payload folder.' }
Write-Ok 'Package complete and undamaged'

$free = (Get-PSDrive -Name ($env:USERPROFILE.Substring(0, 1))).Free
if ($free -lt 10GB) { Stop-WithMessage ("At least 10 GB of free disk space is needed; {0:N1} GB is free." -f ($free / 1GB)) }
Write-Ok ("Free disk space: {0:N0} GB" -f ($free / 1GB))

# ---------------------------------------------------------------- 2. The preservation archive
Write-Step '2. Finding and checking your preservation archive'
$archiveCopy = Join-Path $HQArchiveDir $PreservationName
$candidates = @()
if ($PreservationPath) { $candidates += $PreservationPath }
$candidates += $archiveCopy
$candidates += (Join-Path $env:USERPROFILE "Downloads\HarmonyByrd HQ\$PreservationName")
$candidates += (Join-Path $env:USERPROFILE "Downloads\$PreservationName")
$candidates += (Join-Path (Split-Path -Parent $PackageRoot) $PreservationName)
$found = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $found) {
  Write-Host "   I could not find $PreservationName. Please choose it."
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = "Choose $PreservationName"
  $dlg.Filter = 'Preservation archive (hq-preservation-*.zip)|hq-preservation-*.zip'
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Stop-WithMessage 'No preservation archive chosen. Nothing was installed.' }
  $found = $dlg.FileName
}
Write-Host "   $found"
Write-Host '   Checking its SHA-256 (about a minute)...'
$got = (Get-FileHash -LiteralPath $found -Algorithm SHA256).Hash.ToLower()
if ($got -ne $PreservationSha256) {
  Stop-WithMessage "This file's SHA-256 is $got, not the verified $PreservationSha256. It is not the verified preservation archive, so nothing was installed."
}
Write-Ok 'SHA-256 matches the verified preservation archive'

# Keep an untouched copy, unpack the originals and evidence beside it, and make them read-only.
if ((Resolve-Path -LiteralPath $found).Path -ne $archiveCopy) { Copy-Item -LiteralPath $found -Destination $archiveCopy -Force }
$unpacked = Join-Path $HQArchiveDir $PreservationFolder
if (-not (Test-Path -LiteralPath (Join-Path $unpacked 'SHA256SUMS'))) {
  Write-Host '   Unpacking the captured originals, recovery evidence and source materials...'
  Expand-Archive -LiteralPath $archiveCopy -DestinationPath $HQArchiveDir -Force
}
if ((Test-ArchiveIntegrity) -ne 0) { Stop-WithMessage 'The unpacked archive does not match its checksums. Delete the Archive folder and run the installer again.' }
Get-ChildItem -LiteralPath $HQArchiveDir -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
Write-Ok "Archive kept read-only in $HQArchiveDir"

# ---------------------------------------------------------------- 3. WSL 2
Write-Step '3. Checking Windows Subsystem for Linux (WSL 2)'
if ((Invoke-WslQuiet --version) -ne 0) {
  Write-Host '   WSL is not installed. Windows will ask for permission to install it (one time).'
  Start-Process -FilePath 'wsl.exe' -ArgumentList @('--install', '--no-distribution') -Verb RunAs -Wait
  Write-Host ''
  Write-Host '   WSL has been installed. RESTART WINDOWS now, then double-click' -ForegroundColor Yellow
  Write-Host '   "Install HarmonyByrd HQ" again. It will carry on from here.' -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  Read-Host 'Press Enter to close'
  exit 0
}
Write-Ok 'WSL is installed'

# ---------------------------------------------------------------- 4. The HQ Linux system
Write-Step '4. Setting up the private HQ Linux system'
$first = -not (Test-HQDistro)
if ($first) {
  $arch = 'amd64'; if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $base = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current'
  $name = "ubuntu-noble-wsl-$arch-24.04lts.rootfs.tar.gz"
  $cache = Join-Path $HQProgramDir 'download'
  New-Item -ItemType Directory -Force -Path $cache | Out-Null
  $tar = Join-Path $cache $name
  $sumsUbuntu = Join-Path $cache 'SHA256SUMS'
  Write-Host '   Downloading Ubuntu 24.04 for WSL from ubuntu.com (about 350 MB)...'
  & curl.exe -fL --retry 3 -o $sumsUbuntu "$base/SHA256SUMS"
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Could not reach cloud-images.ubuntu.com. Check the internet connection and run the installer again.' }
  & curl.exe -fL --retry 3 -o $tar "$base/$name"
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'The Ubuntu download failed. Run the installer again.' }
  $wantLine = Get-Content -LiteralPath $sumsUbuntu | Where-Object { $_ -match "\s\*?$([regex]::Escape($name))$" } | Select-Object -First 1
  if (-not $wantLine) { Stop-WithMessage "Ubuntu's checksum list does not name $name." }
  if ((Get-FileHash -LiteralPath $tar -Algorithm SHA256).Hash.ToLower() -ne $wantLine.Substring(0, 64)) { Stop-WithMessage 'The Ubuntu download does not match its published checksum. Run the installer again.' }
  Write-Ok 'Ubuntu download verified'
  New-Item -ItemType Directory -Force -Path $HQSystemDir | Out-Null
  & wsl.exe --import $HQDistro $HQSystemDir $tar --version 2
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage ("WSL could not create the HQ system. If the message above mentions virtualization (for example 0x80370102), " +
      "turn on 'Virtualization' (Intel VT-x / AMD-V / SVM) in your computer's firmware settings, restart, and run the installer again.")
  }
  Remove-Item -LiteralPath $tar -Force
  Write-Ok "HQ Linux system created in $HQSystemDir"
} else {
  Write-Ok 'HQ Linux system already present (updating it)'
}

# systemd on (runs PostgreSQL, HQ and the backup timer); Linux may not start Windows programs.
$wslConf = "[boot]`nsystemd=true`n[interop]`nenabled=false`nappendWindowsPath=false`n[user]`ndefault=root`n"
$confFile = Join-Path $HQProgramDir 'wsl.conf'
[System.IO.File]::WriteAllText($confFile, $wslConf)
[void](Invoke-HQ cp (ConvertTo-WslPath $confFile) /etc/wsl.conf)
[void](Invoke-WslQuiet --terminate $HQDistro)
Start-Sleep -Seconds 3

# ---------------------------------------------------------------- 5. Copy the program files
Write-Step '5. Copying the HQ program files'
foreach ($d in 'scripts', 'launchers', 'linux') {
  Copy-Item -LiteralPath (Join-Path $PackageRoot $d) -Destination $HQProgramDir -Recurse -Force
}
Get-ChildItem -LiteralPath $HQProgramDir -Filter 'harmonybyrd-hq-release-*.zip' | Remove-Item -Force
Copy-Item -LiteralPath $releaseZip.FullName -Destination $HQProgramDir -Force
Copy-Item -LiteralPath (Join-Path $PackageRoot 'Read me first.html') -Destination $HQHome -Force
Write-Ok "Program files in $HQProgramDir"

# ---------------------------------------------------------------- 6. Inside Linux
Write-Step '6. Installing PostgreSQL 16 and HQ, restoring your records, running the checks'
$modeArg = 'update'; if ($first) { $modeArg = 'first' }
$rc = Invoke-HQ bash (ConvertTo-WslPath (Join-Path $HQProgramDir 'linux\hq-windows-setup.sh')) `
  (ConvertTo-WslPath (Join-Path $HQProgramDir $releaseZip.Name)) (ConvertTo-WslPath $archiveCopy) (ConvertTo-WslPath $HQHome) $modeArg
if ($rc -ne 0) { Stop-WithMessage "Installation stopped (see the messages above, and the log $log). Your records and the archive are untouched. Fix the problem named above and run the installer again." }

# ---------------------------------------------------------------- 7. Network exposure from Windows
Write-Step '7. Checking HQ is reachable from this computer only'
if (-not (Start-HQServices)) { Stop-WithMessage "HQ is running inside WSL but does not answer at $HQUrl. See 'If something goes wrong' in Read me first." }
Write-Ok "HQ answers at $HQUrl"
$exposed = @(Get-ExposedListeners)
if ($exposed.Count -gt 0) {
  Stop-WithMessage ("Port(s) " + (($exposed | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ') + " are open beyond this computer. Stop HQ and see 'If something goes wrong' in Read me first.")
}
Write-Ok 'Not reachable from the local network or the internet (ports 3210 and 5432 listen on this computer only)'

# ---------------------------------------------------------------- 8. Shortcuts
Write-Step '8. Shortcuts on the desktop and in the Start menu'
$shell = New-Object -ComObject WScript.Shell
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'HarmonyByrd HQ'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$launchers = Join-Path $HQProgramDir 'launchers'
foreach ($cmd in Get-ChildItem -LiteralPath $launchers -Filter '*.cmd') {
  $lnk = $shell.CreateShortcut((Join-Path $startMenu ($cmd.BaseName + '.lnk')))
  $lnk.TargetPath = $cmd.FullName; $lnk.WorkingDirectory = $launchers; $lnk.Save()
}
$lnk = $shell.CreateShortcut((Join-Path $startMenu 'Read me first.lnk'))
$lnk.TargetPath = (Join-Path $HQHome 'Read me first.html'); $lnk.Save()
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($n in 'Start HarmonyByrd HQ', 'Stop HarmonyByrd HQ') {
  $lnk = $shell.CreateShortcut((Join-Path $desktop "$n.lnk"))
  $lnk.TargetPath = (Join-Path $launchers "$n.cmd"); $lnk.WorkingDirectory = $launchers; $lnk.Save()
}
Write-Ok 'Desktop: Start / Stop HarmonyByrd HQ. Start menu: HarmonyByrd HQ (all tools)'

# ---------------------------------------------------------------- 9. Founder passphrase
$marker = Join-Path $HQProgramDir 'founder-passphrase-issued.txt'
$issue = -not (Test-Path $marker)
if (-not $issue) {
  $ans = Read-Host 'A founder passphrase was issued before. Issue a NEW one now? (y/N)'
  $issue = ($ans -match '^(y|yes)$')
}
if ($issue) {
  Write-Step '9. Your founder passphrase'
  Write-Host '   It is shown ONCE, below. Save it in your password manager now.' -ForegroundColor Yellow
  Write-Host '   (It is not written to the log or to any file.)' -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  $rc = Invoke-HQ /usr/local/bin/hq-passphrase founder
  Start-Transcript -Path $log -Append | Out-Null
  if ($rc -ne 0) { Stop-WithMessage "The passphrase could not be set. Use 'New founder passphrase' from the Start menu." }
  Set-Content -LiteralPath $marker -Value ("Issued {0}. The passphrase itself is not stored here." -f (Get-Date -Format s))
  Read-Host '   Press Enter once you have saved the passphrase'
  Clear-Host
}

Write-Host ''
Write-Host '  INSTALLATION COMPLETE' -ForegroundColor Green
Write-Host "  Opening $HQUrl - sign in as: founder"
Write-Host "  Everything lives in $HQHome (Backups, Archive, Logs)."
Write-Host '  Use "Stop HarmonyByrd HQ" on the desktop when you finish; it makes a backup first.'
Stop-Transcript | Out-Null
Start-Process $HQUrl
Read-Host 'Press Enter to close'
