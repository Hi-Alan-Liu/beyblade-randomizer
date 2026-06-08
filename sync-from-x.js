#!/usr/bin/env node
/**
 * sync-from-x.js — 比對 x 專案與本專案 assets/ 的差異並同步（單向：x → champion）
 *
 * 只讀取 x（來源），只寫入本專案 assets/，絕不修改 x。
 * 比對方式：走訪兩邊檔案樹，用 SHA-1 內容雜湊找出新增/變更/(刪除)。
 * DB 另顯示 x/db/-update.json 的時間戳變化（人類可讀的「哪些 DB 更新了」）。
 * 同步 DB 後會自動重跑 build-db-bundle.js 重新打包 assets/db.bundle.js。
 *
 * 用法：
 *   node sync-from-x.js --dry-run     只列差異，不動任何檔案（建議先跑這個）
 *   node sync-from-x.js               實際同步（複製 x 的新增/變更檔到 assets/）
 *   node sync-from-x.js --prune       連同「x 已刪除但本地還在」的檔一起刪掉（預設不刪）
 *   node sync-from-x.js --src=../x    指定 x 來源路徑（預設為同層的 ../x）
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PRUNE = args.includes("--prune");
const srcArg = args.find((a) => a.startsWith("--src="));

const DEST = __dirname;
let SRC = srcArg ? path.resolve(srcArg.slice(6)) : path.resolve(DEST, "..", "x");

const PAIRS = [
  { from: path.join(SRC, "img"), to: path.join(DEST, "assets", "img"), label: "圖庫 (img)" },
  { from: path.join(SRC, "db"),  to: path.join(DEST, "assets", "db"),  label: "資料 (db)" },
];

function walk(dir, base, acc) {
  base = base || dir; acc = acc || [];
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return acc;
}
function hashFile(p) {
  return crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex");
}
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function diffPair(pair) {
  const srcFiles = new Set(walk(pair.from));
  const dstFiles = new Set(walk(pair.to));
  const added = [], changed = [], removed = [];
  for (const rel of srcFiles) {
    if (!dstFiles.has(rel)) added.push(rel);
    else if (hashFile(path.join(pair.from, rel)) !== hashFile(path.join(pair.to, rel))) changed.push(rel);
  }
  for (const rel of dstFiles) if (!srcFiles.has(rel)) removed.push(rel);
  return { added, changed, removed };
}

// DB 時間戳比較（人類可讀）
function dbTimestampReport() {
  const srcU = path.join(SRC, "db", "-update.json");
  const dstU = path.join(DEST, "assets", "db", "-update.json");
  if (!fs.existsSync(srcU)) return;
  let src = {}, dst = {};
  try { src = JSON.parse(fs.readFileSync(srcU, "utf8")); } catch {}
  try { if (fs.existsSync(dstU)) dst = JSON.parse(fs.readFileSync(dstU, "utf8")); } catch {}
  const changes = [];
  for (const k of Object.keys(src)) {
    if (k === "news") continue;
    if (typeof src[k] === "string" && src[k] !== dst[k]) {
      changes.push(`    ${k}: ${dst[k] || "(無)"} → ${src[k]}`);
    }
  }
  if (changes.length) {
    console.log("  DB 時間戳更新：");
    changes.forEach((c) => console.log(c));
  }
}

function list(label, arr, max) {
  max = max || 12;
  if (!arr.length) return;
  console.log(`  ${label}（${arr.length}）：`);
  arr.slice(0, max).forEach((f) => console.log(`    + ${f}`));
  if (arr.length > max) console.log(`    … 其餘 ${arr.length - max} 筆`);
}

function main() {
  console.log(`同步來源：${SRC}`);
  console.log(`同步目標：${path.join(DEST, "assets")}`);
  console.log(DRY ? "模式：--dry-run（僅預覽，不動檔案）" : (PRUNE ? "模式：實際同步 + --prune（刪除多餘檔）" : "模式：實際同步"));
  console.log("");

  if (!fs.existsSync(SRC)) {
    console.error(`錯誤：找不到來源 x 專案：${SRC}\n（用 --src=路徑 指定，或確認 x 與本專案同層）`);
    process.exit(1);
  }

  let totalAdded = 0, totalChanged = 0, totalRemoved = 0, dbTouched = false;

  for (const pair of PAIRS) {
    const { added, changed, removed } = diffPair(pair);
    console.log(`── ${pair.label} ──`);
    if (!added.length && !changed.length && !removed.length) {
      console.log("  無差異");
    } else {
      list("新增", added);
      list("變更", changed);
      list(PRUNE ? "刪除" : "本地多餘（未刪，加 --prune 才刪）", removed);
      if (pair.label.includes("db")) dbTimestampReport();
    }

    totalAdded += added.length; totalChanged += changed.length; totalRemoved += removed.length;
    if (pair.label.includes("db") && (added.length || changed.length || (PRUNE && removed.length))) dbTouched = true;

    if (!DRY) {
      [...added, ...changed].forEach((rel) => copyFile(path.join(pair.from, rel), path.join(pair.to, rel)));
      if (PRUNE) removed.forEach((rel) => fs.rmSync(path.join(pair.to, rel), { force: true }));
    }
    console.log("");
  }

  console.log(`合計：新增 ${totalAdded}、變更 ${totalChanged}、${PRUNE ? "刪除" : "本地多餘"} ${totalRemoved}`);

  if (DRY) {
    console.log("\n（dry-run 結束，未變更任何檔案。確認無誤後拿掉 --dry-run 重跑即可套用。）");
    return;
  }

  // DB 有變動 → 重新打包 bundle
  if (dbTouched) {
    console.log("\nDB 有變動，重新打包 db.bundle.js …");
    try {
      execFileSync(process.execPath, [path.join(DEST, "build-db-bundle.js")], { stdio: "inherit" });
    } catch (e) {
      console.error("打包失敗：", e.message);
      process.exit(1);
    }
  }
  console.log("\n同步完成。");
}

main();
