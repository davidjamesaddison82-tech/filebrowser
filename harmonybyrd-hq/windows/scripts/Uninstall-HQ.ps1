# Remove the HQ program and its Linux system. KEEPS the Backups and Archive folders.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Write-Host 'This removes HarmonyByrd HQ from this computer: the program and its database.' -ForegroundColor Yellow
Write-Host "A final backup is made first. $HQBackupDir and $HQArchiveDir are KEPT."
if ((Read-Host 'Type REMOVE to continue') -cne 'REMOVE') { Write-Host 'Cancelled; nothing changed.'; Start-Sleep 2; exit 0 }
[void](Start-HQServices)
if ((Invoke-HQ /usr/local/bin/hq-backup) -ne 0) { Stop-WithMessage 'The final backup failed, so nothing was removed.' }
Get-KeepAlive | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
& wsl.exe --unregister $HQDistro
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'HarmonyByrd HQ') -Recurse -Force -ErrorAction SilentlyContinue
foreach ($n in 'Start HarmonyByrd HQ', 'Stop HarmonyByrd HQ') { Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) "$n.lnk") -Force -ErrorAction SilentlyContinue }
Write-Host 'HarmonyByrd HQ has been removed. Your backups and archive are still in:' -ForegroundColor Green
Write-Host "  $HQBackupDir"
Write-Host "  $HQArchiveDir"
Read-Host 'Press Enter to close'
