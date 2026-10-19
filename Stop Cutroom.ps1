$ErrorActionPreference = 'Stop'
$appUrl = 'http://127.0.0.1:4317'
try {
    $config = Invoke-RestMethod -Uri "$appUrl/api/config" -TimeoutSec 3
} catch {
    Write-Host 'Cutroom is not reachable. It may already be stopped.'
    exit 0
}
if ($config.application -ne 'cutroom' -or -not $config.token) {
    Write-Host 'The application on port 4317 is not Cutroom. Nothing was stopped.'
    exit 1
}
try {
    $null = Invoke-RestMethod -Uri "$appUrl/api/shutdown" -Method Post -Headers @{ 'X-Cutroom-Token' = $config.token } -ContentType 'application/json' -Body '{}' -TimeoutSec 3
    Write-Host 'Cutroom stopped. Interrupted projects can be retried after restarting.'
} catch {
    Write-Host ('Could not stop Cutroom: ' + $_.Exception.Message)
    exit 1
}
