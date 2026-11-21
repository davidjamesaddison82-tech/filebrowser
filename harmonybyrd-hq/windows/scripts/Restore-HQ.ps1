# Replace HQ's database with a backup you choose. The current database is backed up first AND kept.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = 'Choose the HarmonyByrd HQ backup to restore'
$dlg.InitialDirectory = $HQBackupDir
$dlg.Filter = 'HQ backups (hq-*.dump)|hq-*.dump'
if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'Nothing chosen; nothing changed.'; Start-Sleep 2; exit 0 }
$file = $dlg.FileName
Write-Host ''
Write-Host "Restore from: $file" -ForegroundColor Yellow
Write-Host 'HQ will then hold exactly what it held when that backup was made.'
Write-Host 'Your current database is backed up first, and also kept inside HQ under another name.'
if ((Read-Host 'Type RESTORE to continue') -cne 'RESTORE') { Write-Host 'Cancelled; nothing changed.'; Start-Sleep 2; exit 0 }

if (-not (Start-HQServices)) { Stop-WithMessage 'HQ could not be started, so nothing was restored.' }
Write-Step 'Backing up the current database first'
if ((Invoke-HQ /usr/local/bin/hq-backup) -ne 0) { Stop-WithMessage 'The safety backup failed, so nothing was restored.' }
Write-Step 'Restoring (the backup is checked before it replaces anything)'
if ((Invoke-HQ /usr/local/bin/hq-rollback db (ConvertTo-WslPath $file)) -ne 0) { Stop-WithMessage 'The restore did not complete. HQ still holds the database it had before.' }
Write-Step 'Checking HQ after the restore'
[void](Start-HQServices)
$rc = Invoke-HQ /usr/local/bin/hq-acceptance --no-baseline
if ($rc -eq 0) { Write-Host 'Restore complete and checked.' -ForegroundColor Green } else { Write-Warn 'Restored, but some checks failed (see above).' }
Read-Host 'Press Enter to close'
