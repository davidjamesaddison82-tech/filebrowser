@echo off
title Install HarmonyByrd HQ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-HQ.ps1"
if errorlevel 1 pause
