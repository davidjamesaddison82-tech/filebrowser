@echo off
title Stop HarmonyByrd HQ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Stop-HQ.ps1"
if errorlevel 1 pause
