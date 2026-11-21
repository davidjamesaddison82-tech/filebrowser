@echo off
title New founder passphrase
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\New-FounderPassphrase.ps1"
if errorlevel 1 pause
