@echo off
title Restore HarmonyByrd HQ from a backup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Restore-HQ.ps1"
if errorlevel 1 pause
