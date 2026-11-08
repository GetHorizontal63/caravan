<#
.SYNOPSIS
  Runs Caravan at Windows startup (as a background scheduled task under SYSTEM).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\install-service.ps1 -DataDir "C:\ProgramData\Caravan" -Port 8420
  Run from an elevated (Administrator) PowerShell. Use -Uninstall to remove.
#>
param(
  [string]$DataDir = "$env:ProgramData\Caravan",
  [int]$Port = 8420,
  [string]$Calibre = "",
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Caravan'
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$TaskName'. Data in $DataDir was left in place."
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "$env:ProgramFiles\nodejs\node.exe" }
if (-not (Test-Path $node)) { throw "Node.js 24+ is required: https://nodejs.org" }
if (-not (Test-Path "$Root\web\dist\index.html")) { throw "Web client not built. Run 'npm run install:all' and 'npm run build' first (from a local drive, not a \server\share path)." }
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# A small launcher so the environment is set for the task.
$launcher = Join-Path $DataDir 'start-caravan.cmd'
@"
@echo off
set CARAVAN_DATA_DIR=$DataDir
set CARAVAN_PORT=$Port
set CARAVAN_WEB_DIR=$Root\web\dist
set CARAVAN_CALIBRE_CONVERT=$Calibre
cd /d "$Root\server"
"$node" src\index.ts >> "$DataDir\caravan.log" 2>&1
"@ | Set-Content -Encoding ASCII $launcher

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

New-NetFirewallRule -DisplayName 'Caravan' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -ErrorAction SilentlyContinue | Out-Null
Write-Host "Caravan is running on http://localhost:$Port (data: $DataDir, log: $DataDir\caravan.log)"
Write-Host "Note: the SYSTEM account cannot see mapped drive letters. Use UNC paths (\nas\share\Books) for libraries."
