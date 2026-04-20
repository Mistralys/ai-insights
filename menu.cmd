@echo off
cd /d "%~dp0"
node scripts\preflight-bootstrap.js
node scripts\cli.js %*
