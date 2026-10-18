<#
.SYNOPSIS
    Antigravity 2.0 한국어 패치 원클릭 실행 스크립트
.DESCRIPTION
    Antigravity 2.0 데스크톱 앱의 네이티브 메뉴(app.asar)와 웹 UI(DOM 런타임)를 한글화합니다.
    Node.js가 설치되어 있지 않은 환경에서도 Antigravity 내장 런타임(ELECTRON_RUN_AS_NODE=1)을 사용해 동작합니다.
.PARAMETER Action
    apply   : 원본 백업 후 한국어 패치 영구 적용 + 현재 실행 중인 창에 즉시 반영 (기본값)
    live    : locales/ko-KR.json 수정 사항을 현재 열린 창에 즉시 핫리로드
    restore : 원본(app.asar.bak) 복원 및 영문 UI로 즉시 되돌리기
    status  : 현재 패치 적용 여부 및 번역 사전 통계 확인
#>
param(
    [ValidateSet("apply", "live", "restore", "status")]
    [string]$Action = "apply"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatcherJs = Join-Path $ScriptDir "src\patcher.js"
$AntigravityExe = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"

$NodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if ($NodeCmd) {
    & $NodeCmd.Source $PatcherJs $Action
} elseif (Test-Path $AntigravityExe) {
    $env:ELECTRON_RUN_AS_NODE = "1"
    & $AntigravityExe $PatcherJs $Action | Out-Host
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
} else {
    Write-Error "Node.js 또는 Antigravity.exe를 찾을 수 없습니다."
    exit 1
}
