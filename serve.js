#!/usr/bin/env node
/**
 * serve.js — 零依賴本機靜態伺服器（給卡片產生器用）
 *
 * 為什麼需要：圖庫圖片改成從 assets/ 路徑載入後，匯出 PNG 需要瀏覽器
 * 能讀取圖片像素。用 file:// 直接開會被瀏覽器擋（tainted canvas / fetch 受限），
 * 匯出會失敗。改用 http 開啟即可正常匯出。編輯/預覽 file:// 仍可用，
 * 但「下載卡片」請務必透過本伺服器開啟。
 *
 * 用法：node serve.js        → http://localhost:8080
 *       node serve.js 3000   → 換 port
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // 防目錄穿越：解析後必須仍在 ROOT 內
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found: " + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`卡片產生器：http://localhost:${PORT}`);
  console.log("（匯出 PNG 請透過此網址開啟；Ctrl+C 結束）");
});
