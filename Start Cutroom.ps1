param([switch]$WithAI, [switch]$NoBrowser, [switch]$NoPause)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$serverFile = Join-Path $projectRoot 'server.mjs'
$dataPath = Join-Path $projectRoot 'data'
$appUrl = 'http://127.0.0.1:4317'
$savedPort = $env:PORT
$savedDataDir = $env:CUTROOM_DATA_DIR
$savedKey = $env:OPENAI_API_KEY
$exitStatus = 0

function Get-CutroomHealth {
    try { return Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2 }
    catch { return $null }
}

try {
    New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
    $running = Get-CutroomHealth
    if ($running -and $running.application -ne 'cutroom') { throw 'Another application is using port 4317. Close that application and try again.' }
    if ($running -and $WithAI -and -not $running.aiReady) {
        throw 'Cutroom is running without AI. Double-click Stop Cutroom.cmd, then Start with AI.cmd.'
    }
    if (-not $running) {
        $nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
        if (-not $nodePath) { throw 'Node.js is not installed or is not on PATH. Install Node.js 22 or newer, then try again.' }
        $nodeVersion = & $nodePath --version
        if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Cutroom requires Node.js 22 or newer.' }
        if (!(Test-Path -LiteralPath $serverFile)) { throw 'server.mjs is missing. Keep this launcher inside the Cutroom folder.' }
        if ($WithAI) {
            Write-Host 'AI mode sends audio and transcripts to OpenAI and uses your API billing.'
            $secureKey = Read-Host 'OpenAI API key (hidden; never saved to a file)' -AsSecureString
            $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
            try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
            if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw 'No API key was entered.' }
        }
        # Keep the launcher's advertised address independent of terminal settings.
        $env:PORT = '4317'
        $env:CUTROOM_DATA_DIR = $dataPath
        Write-Host 'Starting Cutroom...'
        $serverProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 500
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) {
                $logText = Get-Content -LiteralPath (Join-Path $dataPath 'server-error.log') -Raw -ErrorAction SilentlyContinue
                throw "Cutroom stopped during startup. $logText"
            }
            $running = Get-CutroomHealth
            if ($running -and $running.application -eq 'cutroom') { break }
        }
        if (-not $running -or $running.application -ne 'cutroom') {
            throw 'The local server did not answer. See data/server-error.log. If running through a restricted preview, double-click Start Cutroom.cmd directly in Windows File Explorer.'
        }
    }
    Write-Host "Cutroom is running at $appUrl"
    if (-not $running.ffmpegReady) { Write-Host 'Video processing is unavailable. Check tools/ffmpeg.exe or FFMPEG_PATH.' }
    if (-not $NoBrowser) {
        try { Start-Process $appUrl }
        catch { Write-Host "Could not open the default browser automatically. Open $appUrl manually." }
    }
} catch {
    Write-Host ''
    Write-Host ('Unable to start Cutroom: ' + $_.Exception.Message) -ForegroundColor Red
    $exitStatus = 1
    if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
} finally {
    $env:PORT = $savedPort
    $env:CUTROOM_DATA_DIR = $savedDataDir
    $env:OPENAI_API_KEY = $savedKey
}
exit $exitStatus
