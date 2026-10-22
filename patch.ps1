<#
.SYNOPSIS
    Antigravity 2.0 한국어 패치 원클릭 실행 스크립트
.DESCRIPTION
    Antigravity 2.0 데스크톱 앱의 네이티브 메뉴(app.asar)와 웹 UI(DOM 런타임)를 한글화합니다.
    Node.js가 설치되어 있지 않은 환경에서도 Antigravity 내장 런타임(ELECTRON_RUN_AS_NODE=1)을 사용하여 동작합니다.
.PARAMETER Action
    apply           : 원본 백업 후 한국어 패치 영구 적용 + 현재 실행 중인 창에 즉시 반영 (기본값)
    live            : locales/ko-KR.json 수정 사항을 현재 열린 창에 즉시 핫리로드
    restore         : 원본(app.asar.bak) 복원 및 영문 UI로 즉시 되돌리기
    status          : 현재 패치 적용 여부 및 자동 유지 상태, 번역 사전 통계 확인
    watch           : 앱 업데이트 감지 시 자동 재적용하는 감시자(Watcher) 포그라운드 실행
    enable-autoheal : Windows 시작프로그램에 등록하여 PC 부팅 시 백그라운드 자동 유지 활성화
    disable-autoheal: 자동 유지 감시자 프로세스 종료 및 시작프로그램 등록 해제
#>
param(
    [ValidateSet("apply", "live", "restore", "status", "watch", "enable-autoheal", "disable-autoheal")]
    [string]$Action = "apply"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatcherJs = Join-Path $ScriptDir "src\patcher.js"
$AutoHealVbs = Join-Path $ScriptDir "src\auto-heal.vbs"
$AntigravityExe = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutPath = Join-Path $StartupDir "AntigravityKoreanAutoHeal.lnk"

# Function to run patcher with node or electron-as-node
function Invoke-Patcher([string]$SubAction) {
    $NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
    if ($NodeCmd) {
        & $NodeCmd.Source $PatcherJs $SubAction
    } elseif (Test-Path $AntigravityExe) {
        $env:ELECTRON_RUN_AS_NODE = "1"
        & $AntigravityExe $PatcherJs $SubAction | Out-Host
        Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
        Write-Error "Node.js 또는 Antigravity.exe를 찾을 수 없습니다."
        exit 1
    }
}

if ($Action -eq "enable-autoheal") {
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  Antigravity 2.0 한글 패치 자동 유지(Auto-Heal) 활성화" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    # 1. Register Windows Startup shortcut
    if (-not (Test-Path $StartupDir)) {
        New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
    }
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = "`"$AutoHealVbs`" `"$PSCommandPath`""
    $Shortcut.WorkingDirectory = $ScriptDir
    $Shortcut.Description = "Antigravity Korean Auto-Heal Watcher"
    $Shortcut.Save()

    Write-Host "[1/2] Windows 시작프로그램 바로가기 등록 완료:" -ForegroundColor Green
    Write-Host "      -> $ShortcutPath" -ForegroundColor Gray

    # 2. Stop existing watcher if any, then start background watcher immediately
    $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*patch.ps1*watch*" -or $_.CommandLine -like "*patcher.js*watch*"
    }
    if ($existing) {
        $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }

    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$AutoHealVbs`" `"$PSCommandPath`"" -WorkingDirectory $ScriptDir
    Write-Host "[2/2] 백그라운드 자동 감시 프로세스가 즉시 실행되었습니다." -ForegroundColor Green
    Write-Host ""
    Write-Host "[안내] 이제 Antigravity가 자동 업데이트되더라도 2~3초 내에 한글 패치가 자동으로 재적용됩니다!" -ForegroundColor Cyan
    Write-Host "       (해제 명령: .\patch.ps1 -Action disable-autoheal)" -ForegroundColor Gray
    exit 0
}

if ($Action -eq "disable-autoheal") {
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "  Antigravity 2.0 한글 패치 자동 유지(Auto-Heal) 비활성화" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow

    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "[1/2] Windows 시작프로그램 바로가기 삭제 완료." -ForegroundColor Green
    } else {
        Write-Host "[1/2] 시작프로그램에 등록되어 있지 않습니다." -ForegroundColor Gray
    }

    $existing = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*patch.ps1*watch*" -or $_.CommandLine -like "*patcher.js*watch*"
    }
    if ($existing) {
        $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Write-Host "[2/2] 실행 중이던 감시 프로세스를 종료했습니다." -ForegroundColor Green
    } else {
        Write-Host "[2/2] 실행 중인 감시 프로세스가 없습니다." -ForegroundColor Gray
    }

    Write-Host "[완료] 자동 유지 기능이 해제되었습니다." -ForegroundColor Green
    exit 0
}

Invoke-Patcher $Action
