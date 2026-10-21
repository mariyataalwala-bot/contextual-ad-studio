@echo off
title Contextual Ad Studio
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b)
if not exist node_modules\@anthropic-ai\sdk (echo Installing... & call npm install --silent)
call npx playwright install chromium >nul 2>nul
node server.mjs
pause
