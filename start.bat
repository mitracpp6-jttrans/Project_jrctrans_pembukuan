@echo off
title JRC Trans Majalengka - Server Pembukuan
echo ========================================================
echo       MEMULAI SISTEM JRC TRANS MAJALENGKA
echo ========================================================
echo.

if not exist node_modules (
    echo Menginstal dependensi aplikasi...
    call npm install
    echo.
)

echo Membuka browser...
start http://localhost:3000

echo Menjalankan server aplikasi di port 3000...
echo Tekan CTRL + C untuk mematikan server.
echo.
node server.js
pause
