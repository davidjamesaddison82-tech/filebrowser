# Back up, then stop HarmonyByrd HQ. Nothing is lost: the database stays on disk.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Write-Host 'Making a backup before stopping...'
$rc = Invoke-HQ /usr/local/bin/hq-backup
if ($rc -ne 0) {
  Write-Warn 'The backup did not complete (see above). HQ will still be stopped; your data is safe on disk.'
} else {
  Write-Ok "Backup saved in $HQBackupDir"
}
Write-Host 'Stopping HQ...'
[void](Invoke-HQ systemctl stop hq postgresql)
[void](Invoke-WslQuiet --terminate $HQDistro)
Get-KeepAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'HarmonyByrd HQ is stopped.' -ForegroundColor Green
Start-Sleep -Seconds 3
