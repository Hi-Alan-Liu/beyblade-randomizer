#!/usr/bin/env node
/**
 * build-db-bundle.js
 * 把 assets/db/*.json 打包成 assets/db.bundle.js（window.BEY_DB_BUNDLE）。
 *
 * 為什麼需要這支：champion 要能用 file:// 直接打開（離線優先），
 * 但瀏覽器在 file:// 下會擋 fetch() 讀本機 JSON。改成由 <script> 載入
 * 一支 JS 全域變數即可繞過限制，file:// 與 http 兩種開啟方式都能用。
 *
 * JSON 仍是唯一真實來源（由 sync-from-x.js 從 x 專案同步）；
 * 本檔產生的 db.bundle.js 是「衍生物」，同步後需重跑本程式重新產生。
 *
 * 用法：node build-db-bundle.js
 */
const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "assets", "db");
const IMG_DIR = path.join(__dirname, "assets", "img");
const OUT = path.join(__dirname, "assets", "db.bundle.js");

// 走訪 assets/img，回傳所有圖片的相對 posix 路徑（例 "bit/A.png"、"blade/CX/chip/Dr.png"）
function walkImages(dir, base, acc) {
  base = base || dir; acc = acc || [];
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkImages(full, base, acc);
    else if (/\.(png|jpg|jpeg|svg)$/i.test(name)) acc.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return acc;
}

function build() {
  if (!fs.existsSync(DB_DIR)) {
    console.error(`找不到 DB 目錄：${DB_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith(".json"));
  const bundle = {};
  for (const file of files) {
    const key = file.replace(/\.json$/, ""); // 例：part-blade.json → "part-blade"
    const raw = fs.readFileSync(path.join(DB_DIR, file), "utf8");
    try {
      bundle[key] = JSON.parse(raw);
    } catch (e) {
      console.error(`解析失敗：${file} — ${e.message}`);
      process.exit(1);
    }
  }
  // 圖片清單（讓 BeyDB 過濾掉「DB 有資料但沒圖檔」的條目，避免 404 與壞圖）
  bundle.__images = walkImages(IMG_DIR);

  const header =
    "/* 自動產生，請勿手改。來源：assets/db/*.json + assets/img。重新產生：node build-db-bundle.js */\n";
  const body = "window.BEY_DB_BUNDLE = " + JSON.stringify(bundle) + ";\n";
  fs.writeFileSync(OUT, header + body, "utf8");
  const kb = (Buffer.byteLength(body, "utf8") / 1024).toFixed(1);
  console.log(`已產生 ${path.relative(__dirname, OUT)}（${files.length} 個 JSON，${bundle.__images.length} 張圖，${kb} KB）`);
  console.log("包含：" + Object.keys(bundle).filter((k) => k !== "__images").join(", "));
}

build();
