/* BeyDB — 圖庫資料層（消費 window.BEY_DB_BUNDLE，提供查詢）
 *
 * 資料來源：assets/db.bundle.js（由 build-db-bundle.js 從 assets/db/*.json 打包）。
 * 圖檔對應規則（已驗證）：圖檔名(去 .png) == DB 的 key。
 *   上蓋 assets/img/blade/{key}.png
 *   固鎖 assets/img/ratchet/{key}.png
 *   軸心 assets/img/bit/{key}.png
 *   CX 子部件 assets/img/blade/CX/{component}/{key}.png   (component: chip/main/assist/metal/over)
 *
 * 本模組純資料查詢、無 UI。供選圖庫 Modal（第 3 步）與卡片渲染使用。
 */
(function (global) {
  "use strict";

  const RAW = global.BEY_DB_BUNDLE || null;
  const IMG_BASE = "assets/img";
  // 實際存在的圖片集合（相對 img 的 posix 路徑），用來濾掉沒圖檔的 DB 條目
  const IMG_SET = new Set((RAW && RAW.__images) || []);
  function imgExists(relFromImgBase) {
    return IMG_SET.size === 0 || IMG_SET.has(relFromImgBase); // 無清單時不過濾（保險）
  }

  // meta.json 是陣列：[{general}, {glossary}, {search}]
  const META_GENERAL = (RAW && Array.isArray(RAW.meta) && RAW.meta[0] && RAW.meta[0].general) || {};

  // ---- 內部：取某部件類型的原始字典 ----
  // blade 合併「一般」+「聯名/Hasbro」兩份
  function rawDict(partType) {
    if (!RAW) return {};
    if (partType === "blade") {
      return Object.assign({}, RAW["part-blade"] || {}, RAW["part-blade-collab"] || {});
    }
    if (partType === "ratchet") return RAW["part-ratchet"] || {};
    if (partType === "bit") return RAW["part-bit"] || {};
    return {};
  }

  // ---- 顯示名稱：給選圖庫瀏覽用（描述性，盡量中文） ----
  function displayName(partType, key, entry) {
    // 固鎖的代碼本身就是名稱（例 7-70），與卡片合併名稱一致
    if (partType === "ratchet") return key;
    const n = (entry && entry.names) || {};
    const chi = (n.chi || "").trim();
    if (chi) {
      // 多變體格式為「陸版 台版」，取最後(台版)；去掉合體型分隔符 \ 與 /
      const v = chi.split(/\s+/);
      return v[v.length - 1].replace(/[\\/]/g, "");
    }
    return (n.aka || n.eng || n.jap || key);
  }

  // ---- 系統別（BX/UX/CX）：group 優先，否則從 attr 推 ----
  function systemOf(entry) {
    if (!entry) return "other";
    const g = entry.group;
    if (g === "BX" || g === "UX" || g === "CX") return g;
    const attr = entry.attr || [];
    if (attr.includes("CX")) return "CX";
    if (attr.includes("UX")) return "UX";
    if (attr.includes("BX")) return "BX";
    return "other";
  }

  // ---- 圖片路徑 ----
  function imgPath(partType, key) {
    return `${IMG_BASE}/${partType}/${key}.png`;
  }
  function cxImgPath(component, key) {
    return `${IMG_BASE}/blade/CX/${component}/${key}.png`;
  }

  // ---- 一筆標準化條目 ----
  function makeEntry(partType, key, raw) {
    return {
      partType,
      key,
      group: raw && raw.group ? raw.group : null,
      system: systemOf(raw),
      names: (raw && raw.names) || {},
      name: displayName(partType, key, raw),
      stat: (raw && raw.stat) || null,
      desc: (raw && raw.desc) || "",
      attr: (raw && raw.attr) || [],
      fused: !!(raw && raw.attr && raw.attr.includes("fused")),
      img: imgPath(partType, key),
    };
  }

  const BeyDB = {
    /** bundle 是否成功載入 */
    get ready() {
      return !!RAW;
    },

    /** 部件中文/日文/英文名稱對照（來自 meta） */
    partNames() {
      return (META_GENERAL.part && META_GENERAL.part.names) || {};
    },

    /** 列出某部件類型全部條目（blade/ratchet/bit），已標準化；濾掉沒圖檔的 */
    list(partType) {
      const dict = rawDict(partType);
      return Object.keys(dict)
        .filter((key) => imgExists(`${partType}/${key}.png`))
        .map((key) => makeEntry(partType, key, dict[key]));
    },

    /** 取單一條目 */
    get(partType, key) {
      const dict = rawDict(partType);
      if (!(key in dict)) return null;
      return makeEntry(partType, key, dict[key]);
    },

    /** 某部件類型出現過的系統別（依 BX→UX→CX→other 排序，只回有資料的） */
    systems(partType) {
      const order = ["BX", "UX", "CX", "hasbro", "other"];
      const seen = new Set(this.list(partType).map((e) => e.system));
      return order.filter((s) => seen.has(s));
    },

    /** 以名稱（中/日/英/別名/代碼）模糊搜尋 */
    search(partType, query) {
      const q = (query || "").trim().toLowerCase();
      const all = this.list(partType);
      if (!q) return all;
      return all.filter((e) => {
        const n = e.names || {};
        const hay = [e.key, e.name, n.chi, n.eng, n.jap, n.aka]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    },

    // ===== CX 拆解上蓋 =====

    /** CX 組合規則：{ "3":[chip,main,assist], "4":[chip,metal,over,assist], index:{...} } */
    cxComposition() {
      const sub = META_GENERAL.blade && META_GENERAL.blade.sub && META_GENERAL.blade.sub.CX;
      return sub || null;
    },

    /** 某 CX 模式（3 或 4）的子部件順序陣列 */
    cxComponents(mode) {
      const comp = this.cxComposition();
      if (!comp) return [];
      return comp[String(mode)] || [];
    },

    /** 列出某 CX 子部件（chip/main/assist/metal/over）的全部條目 */
    cxList(component) {
      const divided = (RAW && RAW["part-blade-divided"] && RAW["part-blade-divided"].CX) || {};
      const dict = divided[component] || {};
      return Object.keys(dict).filter((key) => imgExists(`blade/CX/${component}/${key}.png`)).map((key) => {
        const raw = dict[key];
        const n = (raw && raw.names) || {};
        return {
          partType: "blade",
          component,
          key,
          system: "CX",
          names: n,
          name: (n.chi && n.chi.trim().split(/\s+/).pop().replace(/[\\/]/g, "")) || n.eng || n.jap || key,
          stat: (raw && raw.stat) || null,
          desc: (raw && raw.desc) || "",
          attr: (raw && raw.attr) || [],
          img: cxImgPath(component, key),
        };
      });
    },

    /** 取單一 CX 子部件條目 */
    cxGet(component, key) {
      return this.cxList(component).find((e) => e.key === key) || null;
    },

    /** DB 各檔更新時間戳（供同步工具/顯示用） */
    updatedAt() {
      return RAW ? RAW["-update"] : null;
    },
  };

  global.BeyDB = BeyDB;
})(window);
