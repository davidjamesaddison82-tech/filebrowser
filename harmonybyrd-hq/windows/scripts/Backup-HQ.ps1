# Make a backup now (restore-tested before it is kept), then open the Backups folder.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Write-Host 'Making a backup (each backup is test-restored and checked before it is kept)...'
$rc = Invoke-HQ /usr/local/bin/hq-backup
if ($rc -ne 0) { Stop-WithMessage 'The backup failed (see above). Run "Check HarmonyByrd HQ" for details.' }
Write-Ok "Backup saved in $HQBackupDir"
Write-Host 'Tip: copy this folder to a USB drive now and then, so a copy survives if the laptop is lost.'
Start-Process explorer.exe $HQBackupDir
Read-Host 'Press Enter to close'
