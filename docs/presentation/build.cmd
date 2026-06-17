@echo off
:: Build the presentation slides.
:: Output: dist\ai-insights-slides.html
::
:: Usage:
::   build.cmd           -- single build
::   build.cmd --watch   -- rebuild on source changes

cd /d "%~dp0"
node tools\build.js %*
