@echo off
title JRCTRANS Majalengka - Server Pembukuan
echo ========================================================
echo       MEMULAI SISTEM JRCTRANS MAJALENGKA
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
