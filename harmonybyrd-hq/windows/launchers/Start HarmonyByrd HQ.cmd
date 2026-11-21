@echo off
title Start HarmonyByrd HQ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Start-HQ.ps1"
if errorlevel 1 pause
