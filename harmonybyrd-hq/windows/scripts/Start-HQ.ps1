# Start HarmonyByrd HQ and open it in the browser.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
Write-Host 'Starting HarmonyByrd HQ (up to two minutes)...'
if (-not (Start-HQServices)) {
  Stop-WithMessage "HQ did not answer at $HQUrl. Try 'Stop HarmonyByrd HQ', then Start again. If it still fails, run 'Check HarmonyByrd HQ' from the Start menu."
}
if ((Test-NetworkExposure).Count -gt 0) {
  Stop-WithMessage "HQ is reachable from beyond this computer. Use 'Stop HarmonyByrd HQ' now and see 'If something goes wrong' in Read me first."
}
Write-Host "HQ is running at $HQUrl (this computer only). Opening your browser..." -ForegroundColor Green
Start-Process $HQUrl
Start-Sleep -Seconds 3
