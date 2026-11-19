@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [CSBP] 启动本地静态服务 http://127.0.0.1:3000 与本机信令服务 ws://127.0.0.1:9000 ...
start "CSBP Web 3000" cmd /k python -m http.server 3000 --bind 127.0.0.1
start "CSBP Signal 9000" cmd /k node server\peer-server.js
timeout /t 2 >nul
start "" http://127.0.0.1:3000
