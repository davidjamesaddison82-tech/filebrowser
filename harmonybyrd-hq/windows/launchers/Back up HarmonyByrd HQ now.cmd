@echo off
title Back up HarmonyByrd HQ now
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Backup-HQ.ps1"
if errorlevel 1 pause
