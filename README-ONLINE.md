HEROES KNIGHT — 2 PLAYER ONLINE

Isi:
- index.html = game
- server.js = multiplayer server
- package.json = Node dependencies
- render.yaml = konfigurasi deploy Render

CARA ONLINE:
1. Upload folder ini ke GitHub sebagai repository.
2. Di Render pilih New > Web Service lalu hubungkan repository tersebut.
3. Build Command: npm install
4. Start Command: npm start
5. Setelah deploy selesai, Render memberikan URL https://....onrender.com
6. HP 1 dan HP 2 cukup membuka URL yang sama.
7. HP 1 pilih Create Room, HP 2 pilih Join Room dan masukkan kode.

Catatan:
- Tidak perlu Node.js di HP pemain.
- Server Node.js berjalan di Render.
- Karena game menggunakan WebSocket, koneksi publik memakai HTTPS/WSS.
- Paket gratis Render cocok untuk pengujian/hobi dan dapat tidur setelah tidak aktif.
