# Windows 日常入口：无需激活旧 Compose 项目，也不依赖 Node.js。
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot 'apps/api/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    $pythonPath = (Get-Command python -ErrorAction Stop).Source
}
Push-Location -LiteralPath $projectRoot
try {
    & $pythonPath -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'
    if ($LASTEXITCODE -ne 0) { throw '需要 Python 3.11 或更新版本。' }
    & $pythonPath -X utf8 (Join-Path $PSScriptRoot 'local_ops.py') @Arguments
    $result = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $result
