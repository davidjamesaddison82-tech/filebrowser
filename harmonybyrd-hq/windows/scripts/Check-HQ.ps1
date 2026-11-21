# Independent checks: records intact, archive unchanged, read-only AI access, nothing exposed, backups.
. (Join-Path $PSScriptRoot 'HQ-Common.ps1')
Assert-HQInstalled
$report = Join-Path $HQLogDir ("check-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -Path $report | Out-Null
Write-Step 'Starting HQ if needed'
if (Start-HQServices) { Write-Ok "HQ answers at $HQUrl" } else { Write-Warn "HQ does not answer at $HQUrl" }
Write-Step 'Network: HQ must be reachable from this computer only'
$exposed = Test-NetworkExposure
if ($exposed.Count -eq 0) { Write-Ok 'HQ and PostgreSQL are not reachable from the network' } else { foreach ($p in $exposed) { Write-Warn $p } }
Write-Step 'Archive: captured originals, recovery evidence and source materials unchanged'
$bad = Test-ArchiveIntegrity
Write-Step 'Inside HQ: records, seals, 38 restoration checks, read-only AI access, rate limit, backups'
$mode = @()
$ans = Read-Host 'Have you added or changed records in HQ since installing it? (y/N)'
if ($ans -match '^(y|yes)$') { $mode = @('--no-baseline'); Write-Host '   (the 38 preserved-results comparison is skipped; the integrity checks still run)' }
$rc = Invoke-HQ /usr/local/bin/hq-acceptance @mode
Write-Host ''
if ($rc -eq 0 -and $bad -eq 0 -and $exposed.Count -eq 0) { Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green } else { Write-Host 'SOME CHECKS FAILED - see above' -ForegroundColor Red }
Stop-Transcript | Out-Null
Write-Host "Report saved: $report"
Read-Host 'Press Enter to close'
