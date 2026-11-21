@echo off
title Check HarmonyByrd HQ
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\Check-HQ.ps1"
if errorlevel 1 pause
