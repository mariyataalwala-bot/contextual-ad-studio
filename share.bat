@echo off
title Contextual Ad Studio - Share link
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b)
if not exist node_modules\@google\genai (echo Installing... & call npm install --silent)
node share.mjs
pause
