# AnimaImagineSkill 启动脚本 (PowerShell)
#
# 用法：
#   cd AnimaImagineSkill
#   .\start.ps1
#   .\start.ps1 -ModelDir "D:\models"        # 指定模型目录
#   .\start.ps1 -Port 9000                   # 指定端口

param(
    # 模型根目录（包含 diffusion_models/ text_encoders/ vae/ 子目录）
    # 默认指向本项目下的 models/ 目录（与 config.example.yaml 保持一致）
    [string]$ModelDir = ".\models",
    # Anima 版本: preview / preview2 / preview3
    [string]$Version = "preview3",
    # 默认端口与 config.example.yaml 保持一致
    [int]$Port = 8000,
    [string]$Device = "cuda",
    [switch]$LowVram
)

# --- 查找 Python ---
# 优先使用本项目自己的 .venv（uv sync 创建），其次尝试上级目录的 .venv。
$LocalVenv = Join-Path $PSScriptRoot ".venv" "Scripts" "python.exe"
$ParentVenv = Join-Path $PSScriptRoot ".." ".venv" "Scripts" "python.exe"

if (Test-Path $LocalVenv) {
    $VenvPython = (Resolve-Path $LocalVenv).Path
} elseif (Test-Path $ParentVenv) {
    $VenvPython = (Resolve-Path $ParentVenv).Path
} else {
    Write-Host "[ERROR] 找不到 .venv，请先执行: uv sync" -ForegroundColor Red
    exit 1
}
Write-Host "[config] Python = $VenvPython"

# --- 设置环境变量 ---
if ($ModelDir) {
    $env:ANIMA_MODEL_DIR = (Resolve-Path $ModelDir -ErrorAction SilentlyContinue)?.Path ?? $ModelDir
    Write-Host "[config] ANIMA_MODEL_DIR = $($env:ANIMA_MODEL_DIR)"
}
if ($Version) {
    $env:ANIMA_MODEL_VERSION = $Version
    Write-Host "[config] ANIMA_MODEL_VERSION = $Version"
}
$env:ANIMA_PORT = $Port
$env:ANIMA_DEVICE = $Device
if ($LowVram) { $env:ANIMA_LOW_VRAM = "true" }

Write-Host ""
Write-Host "============================================================"
Write-Host "  AnimaImagineSkill"
Write-Host "  MCP Endpoint : http://localhost:${Port}/mcp/"
Write-Host "  Gallery      : http://localhost:${Port}/"
Write-Host "============================================================"
Write-Host ""

# --- 启动服务 ---
& $VenvPython -m anima_imagine
