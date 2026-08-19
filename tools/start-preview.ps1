$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$url = "http://127.0.0.1:4173/"

function Test-AcoustiCorePreview {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains("AcoustiCore")
    }
    catch {
        return $false
    }
}

if (-not (Test-AcoustiCorePreview)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $nodeCandidates = @(
        $(if ($nodeCommand) { $nodeCommand.Source }),
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

    $nodeExe = $nodeCandidates | Select-Object -First 1
    if (-not $nodeExe) {
        Write-Host "AcoustiCore preview requires Node.js 20 or newer."
        exit 1
    }

    Start-Process -FilePath $nodeExe `
        -ArgumentList "tools/serve.mjs", "--host", "127.0.0.1", "--port", "4173" `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden

    foreach ($attempt in 1..20) {
        Start-Sleep -Milliseconds 200
        if (Test-AcoustiCorePreview) { break }
    }
}

if (-not (Test-AcoustiCorePreview)) {
    Write-Host "AcoustiCore preview could not start on 127.0.0.1:4173."
    exit 1
}

Start-Process $url
exit 0
