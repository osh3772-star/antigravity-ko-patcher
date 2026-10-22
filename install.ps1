<#
.SYNOPSIS
    Antigravity 2.0 한국어 패치 원클릭 온라인 설치 스크립트 (install.ps1)
.DESCRIPTION
    Git 설치 여부와 무관하게 ~/.gemini/antigravity-ko-patcher 경로에 패치 도구를 다운로드하고
    즉시 Antigravity 2.0 한국어 패치(apply) 및 자동 유지(enable-autoheal)를 적용합니다.
.EXAMPLE
    irm https://raw.githubusercontent.com/osh3772-star/antigravity-ko-patcher/main/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoUrl = "https://github.com/osh3772-star/antigravity-ko-patcher.git"
$RawBase = "https://raw.githubusercontent.com/osh3772-star/antigravity-ko-patcher/main"
$InstallDir = Join-Path $env:USERPROFILE ".geminiantigravity-ko-patcher"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Antigravity 2.0 한국어 패치 자동 설치기 (Auto Installer)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$GitCmd = Get-Command "git" -ErrorAction SilentlyContinue

if ($GitCmd) {
    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Host "[설치기] 기존 설치 폴더 발견 -> 최신 버전으로 업데이트 중..." -ForegroundColor Yellow
        git -C $InstallDir pull --ff-only
    } else {
        if (Test-Path $InstallDir) {
            Remove-Item -Path $InstallDir -Recurse -Force
        }
        Write-Host "[설치기] GitHub 저장소 클론 중 -> $InstallDir" -ForegroundColor Yellow
        git clone --depth 1 $RepoUrl $InstallDir
    }
} else {
    Write-Host "[설치기] Git 미설치 환경 감지 -> GitHub Raw 파일 직접 다운로드 중..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "src") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "locales") | Out-Null

    $Files = @(
        "patch.ps1",
        "README.md",
        "AGENTS.md",
        "src/patcher.js",
        "src/i18n-runtime.js",
        "src/auto-heal.vbs",
        "locales/ko-KR.json"
    )
    foreach ($File in $Files) {
        $Target = Join-Path $InstallDir ($File -replace "/", "")
        Invoke-WebRequest -Uri "$RawBase/$File" -UseBasicParsing -OutFile $Target
    }
}

$PatchScript = Join-Path $InstallDir "patch.ps1"
Write-Host "[설치기] 다운로드 완료! 한국어 패치를 즉시 적용합니다..." -ForegroundColor Green
& powershell -ExecutionPolicy Bypass -File $PatchScript -Action apply

Write-Host "[설치기] 앱 업데이트 시 한글이 풀리지 않도록 자동 유지(Auto-Heal)를 등록합니다..." -ForegroundColor Green
& powershell -ExecutionPolicy Bypass -File $PatchScript -Action enable-autoheal
