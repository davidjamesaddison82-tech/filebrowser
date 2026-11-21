# Issue a new founder passphrase (the old one stops working). Shown once; never saved to a file.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Write-Host 'This replaces the founder passphrase. The old one will stop working.' -ForegroundColor Yellow
if ((Read-Host 'Type NEW to continue') -cne 'NEW') { Write-Host 'Cancelled.'; Start-Sleep 2; exit 0 }
if (-not (Start-HQServices)) { Stop-WithMessage 'HQ could not be started.' }
Write-Host 'Your new passphrase is shown ONCE below. Save it in your password manager now.' -ForegroundColor Yellow
if ((Invoke-HQ /usr/local/bin/hq-passphrase founder) -ne 0) { Stop-WithMessage 'The passphrase could not be changed.' }
Read-Host 'Press Enter once you have saved it (the window will then be cleared)'
Clear-Host
