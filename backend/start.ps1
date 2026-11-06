param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    Write-Host 'Creating local Python environment...'
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create .venv' }
}
& $pythonPath -c "import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(m) for m in ('fastapi','uvicorn','pydantic','httpx','wsproto','psycopg','psycopg_binary')) else 1)"
if ($LASTEXITCODE -ne 0) {
    & $pythonPath -m pip install -r requirements-lock.txt
    if ($LASTEXITCODE -ne 0) {
        & $pythonPath -m pip install --index-url https://pypi.org/simple -r requirements-lock.txt
        if ($LASTEXITCODE -ne 0) { throw 'Failed to install dependencies; see README.md' }
    }
}
Write-Host "API docs: http://127.0.0.1:$Port/docs"
& $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $Port --workers 1 --ws wsproto
exit $LASTEXITCODE
