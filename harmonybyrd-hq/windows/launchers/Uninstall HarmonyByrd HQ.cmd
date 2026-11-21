@echo off
title Uninstall HarmonyByrd HQ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Uninstall-HQ.ps1"
if errorlevel 1 pause
