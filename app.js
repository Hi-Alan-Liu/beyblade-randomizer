/* 戰鬥陀螺・隨機組裝產生器 — app.js
 *
 * 資料層完全沿用 beyblade-champion 的 BeyDB（db.js）：名稱顯示規則
 * （displayName：中文取台版、去合體分隔符）、CX 組裝規則（meta.blade.sub.CX）、
 * CX 子部件查詢（cxList/cxGet）皆與 champion 一致 → 卡片圖文顯示同邏輯。
 *
 * 本檔負責三件事：
 *   1) 零件庫存勾選（上蓋 BX/UX/… + CX 自組收藏 / 軸心 / 固鎖），存 localStorage
 *   2) CX 上蓋組裝器：自己挑 chip +(main 或 metal+over)+ assist，命名存成一顆整體上蓋
 *   3) 隨機產生 1~3 顆，附拉霸（slot machine）動畫
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const CX_STACK_ORDER = ["chip", "over", "metal", "main", "assist"]; // 由上而下堆疊
  const FILLERS = 22;        // 拉霸滾動時的填充影格數
  const CELL = 116;          // 單格高度，需與 styles.css .frame 一致
  const SYS_LABEL = { BX: "BX", UX: "UX", CX: "CX", hasbro: "Hasbro", other: "其他" };

  if (!window.BeyDB || !BeyDB.ready) {
    document.body.innerHTML =
      '<p style="color:#e0607a;padding:40px;text-align:center">資料未載入：請確認 assets/db.bundle.js 存在（執行 node build-db-bundle.js），並以 http 開啟（node serve.js）。</p>';
    return;
  }

  // ===== 狀態 + 本機暫存 =====
  const STORE = "bey-randomizer-v1";
  const state = {
    tab: "blade",
    sys: BeyDB.systems("blade")[0] || "BX",
    search: "",
    owned: { blade: new Set(), ratchet: new Set(), bit: new Set() },
    cx: [],            // 自組 CX 上蓋收藏：{id,name,mode,comps,included}
    count: 1,
    noDup: true,        // 上蓋不重複
    noDupRatchet: true, // 固鎖不重複
    noDupBit: true,     // 軸心不重複
  };

  function save() {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        owned: {
          blade: [...state.owned.blade],
          ratchet: [...state.owned.ratchet],
          bit: [...state.owned.bit],
        },
        cx: state.cx,
        count: state.count,
        noDup: state.noDup,
        noDupRatchet: state.noDupRatchet,
        noDupBit: state.noDupBit,
      })
    );
  }
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (d.owned) {
        ["blade", "ratchet", "bit"].forEach((p) => {
          state.owned[p] = new Set(d.owned[p] || []);
        });
      }
      if (Array.isArray(d.cx)) state.cx = d.cx;
      if (d.count) state.count = d.count;
      if (typeof d.noDup === "boolean") state.noDup = d.noDup;
      if (typeof d.noDupRatchet === "boolean") state.noDupRatchet = d.noDupRatchet;
      if (typeof d.noDupBit === "boolean") state.noDupBit = d.noDupBit;
    } catch (e) { /* 壞資料就用預設 */ }
  }

  function toast(msg, bad) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = "toast"), 2200);
  }

  // ===== CX 堆疊 HTML（結果格 / 預覽 / 縮圖共用） =====
  function cxStackHTML(comps) {
    const layers = CX_STACK_ORDER.filter((c) => comps[c] && comps[c].img)
      .map((c) => `<img class="cx-sub cx-${c}" src="${comps[c].img}" alt="" />`)
      .join("");
    return `<div class="cx-stack">${layers}</div>`;
  }
  function cxThumb(comps) {
    return (comps.main && comps.main.img) || (comps.chip && comps.chip.img) ||
      (CX_STACK_ORDER.map((c) => comps[c] && comps[c].img).find(Boolean)) || "";
  }

  // ===== 庫存渲染 =====
  function bladeItems() {
    // 一般上蓋（BX/UX/other），依目前系統次分頁過濾；CX 分頁則列自組收藏
    if (state.sys === "CX") {
      return state.cx.map((cx) => ({
        kind: "cxblade", id: cx.id, key: "cx:" + cx.id, name: cx.name,
        comps: cx.comps, included: cx.included !== false, isCx: true,
      }));
    }
    return BeyDB.list("blade")
      .filter((e) => e.system === state.sys)
      .map((e) => ({ kind: "blade", key: e.key, name: e.name, img: e.img, names: e.names, fused: e.fused, system: e.system }));
  }
  function partItems(part) {
    if (part === "blade") return bladeItems();
    // 固鎖(ratchet)/軸心(bit)：code = 資料庫 key（合併名稱用，例 2-80 / C / GN）
    return BeyDB.list(part).map((e) => ({ kind: part, key: e.key, code: e.key, name: e.name, img: e.img, names: e.names, fused: e.fused }));
  }

  function matchSearch(item) {
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    const n = item.names || {};
    return [item.key, item.name, n.chi, n.eng, n.jap, n.aka].filter(Boolean).join(" ").toLowerCase().includes(q);
  }

  function renderSystems() {
    const wrap = $("sysTabs");
    if (state.tab !== "blade") { wrap.innerHTML = ""; return; }
    const systems = [...BeyDB.systems("blade"), "CX"]; // CX 永遠列在最後（走自組收藏）
    wrap.innerHTML = systems
      .map((s) => `<button type="button" class="sys-tab ${s === state.sys ? "active" : ""}" data-sys="${s}">${SYS_LABEL[s] || s}</button>`)
      .join("");
    wrap.querySelectorAll(".sys-tab").forEach((b) =>
      b.addEventListener("click", () => { state.sys = b.dataset.sys; renderSystems(); renderGrid(); })
    );
  }

  function isOwned(item) {
    if (item.kind === "cxblade") return item.included;
    return state.owned[item.kind].has(item.key);
  }

  function renderGrid() {
    const grid = $("partGrid");
    const addBtn = $("cxAddBtn");
    addBtn.hidden = !(state.tab === "blade" && state.sys === "CX");

    const items = partItems(state.tab).filter(matchSearch);
    if (!items.length) {
      const msg = state.tab === "blade" && state.sys === "CX"
        ? '尚未組裝任何 CX 上蓋。按右上「＋ 組裝新 CX 上蓋」開始。'
        : "找不到符合的零件。";
      grid.innerHTML = `<div class="empty-grid">${msg}</div>`;
      updateCounts();
      return;
    }
    grid.innerHTML = items
      .map((it) => {
        const owned = isOwned(it);
        const imgHTML = it.kind === "cxblade" ? cxStackHTML(it.comps) : `<img src="${it.img}" loading="lazy" alt="${it.name}" />`;
        const tag = it.kind === "cxblade" ? '<span class="pc-tag">CX</span>' : (it.fused ? '<span class="pc-tag">合體</span>' : "");
        const del = it.kind === "cxblade" ? `<div class="pc-del" data-del="${it.id}" title="刪除此 CX 上蓋">✕</div>` : "";
        // 固鎖/軸心以代碼(key)為主標、名稱為副標；上蓋用中文名
        const isCode = it.kind === "ratchet" || it.kind === "bit";
        const primary = isCode ? it.key : (it.name || it.key);
        const sub = isCode && it.name && it.name !== it.key ? `<div class="pc-sub">${it.name}</div>` : "";
        return `<div class="part-cell ${owned ? "owned" : ""} ${it.isCx ? "is-cx" : ""}" data-key="${it.key}" data-kind="${it.kind}">
          ${tag}
          <div class="pc-check">✓</div>
          <div class="pc-img">${imgHTML}</div>
          <div class="pc-name">${primary}${sub}</div>
          ${del}
        </div>`;
      })
      .join("");

    grid.querySelectorAll(".part-cell").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        if (e.target.closest(".pc-del")) return;
        toggleOwn(cell.dataset.kind, cell.dataset.key);
        cell.classList.toggle("owned");
        updateCounts();
      });
    });
    grid.querySelectorAll(".pc-del").forEach((d) =>
      d.addEventListener("click", (e) => { e.stopPropagation(); deleteCx(d.dataset.del); })
    );
    updateCounts();
  }

  function toggleOwn(kind, key) {
    if (kind === "cxblade") {
      const id = key.slice(3);
      const cx = state.cx.find((c) => c.id === id);
      if (cx) cx.included = cx.included === false;
      save();
      return;
    }
    const set = state.owned[kind];
    if (set.has(key)) set.delete(key); else set.add(key);
    save();
  }

  function bulk(mode) {
    if (state.tab === "blade" && state.sys === "CX") {
      const vis = bladeItems().filter(matchSearch);
      vis.forEach((it) => {
        const cx = state.cx.find((c) => c.id === it.id);
        if (!cx) return;
        cx.included = mode === "all" ? true : mode === "none" ? false : cx.included === false;
      });
    } else {
      const kind = state.tab;
      const vis = partItems(kind).filter(matchSearch);
      const set = state.owned[kind];
      vis.forEach((it) => {
        if (mode === "all") set.add(it.key);
        else if (mode === "none") set.delete(it.key);
        else set.has(it.key) ? set.delete(it.key) : set.add(it.key);
      });
    }
    save();
    renderGrid();
  }

  function updateCounts() {
    $("cnt-blade").textContent = state.owned.blade.size + state.cx.filter((c) => c.included !== false).length;
    $("cnt-ratchet").textContent = state.owned.ratchet.size;
    $("cnt-bit").textContent = state.owned.bit.size;
  }

  // ===== CX 上蓋組裝器 =====
  let cxDraft = { mode: 3, comps: {}, editId: null, nameTouched: false };

  const CX_COMP_LABEL = { chip: "紋章鎖", over: "超越刃", metal: "金屬刃", main: "主刃／鋼鐵戰刃", assist: "輔助戰刃" };

  function openCx(editId) {
    cxDraft = { mode: 3, comps: {}, editId: editId || null, nameTouched: false };
    if (editId) {
      const cx = state.cx.find((c) => c.id === editId);
      if (cx) {
        cxDraft.mode = cx.mode || 3;
        cxDraft.comps = JSON.parse(JSON.stringify(cx.comps || {}));
        cxDraft.nameTouched = true;
        $("cxName").value = cx.name || "";
      }
    } else {
      $("cxName").value = "";
    }
    document.querySelectorAll(".cx-mode-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.mode) === cxDraft.mode));
    renderCxBuilder();
    $("cxModal").classList.remove("hidden");
  }
  function closeCx() { $("cxModal").classList.add("hidden"); }

  function autoName() {
    const order = BeyDB.cxComponents(cxDraft.mode);
    return order
      .filter((c) => cxDraft.comps[c])
      .map((c) => (c === "assist" || c === "over" ? cxDraft.comps[c].key : cxDraft.comps[c].name))
      .join("");
  }

  function renderCxBuilder() {
    // 預覽 + 自動命名
    $("cxPreview").outerHTML = cxStackHTML(cxDraft.comps).replace('class="cx-stack"', 'class="cx-stack" id="cxPreview"');
    const nm = autoName();
    $("cxPreviewName").textContent = nm || "（尚未選擇）";
    if (!cxDraft.nameTouched) $("cxName").value = nm;

    const comps = BeyDB.cxComponents(cxDraft.mode).slice().sort((a, b) => CX_STACK_ORDER.indexOf(a) - CX_STACK_ORDER.indexOf(b));
    $("cxBuilder").innerHTML = comps
      .map((c) => {
        const picked = cxDraft.comps[c];
        const opts = BeyDB.cxList(c);
        return `<div class="cx-section" data-comp="${c}">
          <h4>${CX_COMP_LABEL[c] || c} <small>${c}</small>${picked ? `<span class="cx-picked">已選：${picked.name}</span>` : ""}</h4>
          <div class="cx-opts">
            <button type="button" class="cx-opt clear-opt ${picked ? "" : "active"}" data-comp="${c}" data-key="">清除</button>
            ${opts.map((o) => `<button type="button" class="cx-opt ${picked && picked.key === o.key ? "active" : ""}" data-comp="${c}" data-key="${o.key}">
                <img src="${o.img}" loading="lazy" alt="${o.name}" /><span>${o.name}</span>
              </button>`).join("")}
          </div>
        </div>`;
      })
      .join("");

    $("cxBuilder").querySelectorAll(".cx-opt").forEach((b) =>
      b.addEventListener("click", () => {
        const c = b.dataset.comp, k = b.dataset.key;
        if (!k) delete cxDraft.comps[c];
        else cxDraft.comps[c] = pickCx(c, k);
        renderCxBuilder();
      })
    );
  }
  function pickCx(component, key) {
    const e = BeyDB.cxGet(component, key);
    return e ? { key: e.key, img: e.img, name: e.name } : null;
  }

  function saveCx() {
    const need = BeyDB.cxComponents(cxDraft.mode);
    const missing = need.filter((c) => !cxDraft.comps[c]);
    if (missing.length) { toast("還缺：" + missing.map((c) => CX_COMP_LABEL[c]).join("、"), true); return; }
    const name = ($("cxName").value.trim()) || autoName() || "CX 上蓋";
    const comps = {};
    need.forEach((c) => (comps[c] = cxDraft.comps[c]));
    if (cxDraft.editId) {
      const cx = state.cx.find((c) => c.id === cxDraft.editId);
      if (cx) { cx.mode = cxDraft.mode; cx.comps = comps; cx.name = name; }
    } else {
      state.cx.push({ id: "cx" + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name, mode: cxDraft.mode, comps, included: true });
    }
    save();
    closeCx();
    state.tab = "blade"; state.sys = "CX";
    syncTabsUI(); renderSystems(); renderGrid();
    toast("已儲存 CX 上蓋：" + name);
  }
  function deleteCx(id) {
    const cx = state.cx.find((c) => c.id === id);
    if (!cx) return;
    if (!confirm(`刪除 CX 上蓋「${cx.name}」？`)) return;
    state.cx = state.cx.filter((c) => c.id !== id);
    save(); renderGrid();
  }

  // ===== 隨機池 =====
  function bladePool() {
    const normal = BeyDB.list("blade")
      .filter((e) => state.owned.blade.has(e.key))
      .map((e) => ({ kind: "blade", id: e.key, name: e.name, img: e.img, fused: e.fused }));
    const cx = state.cx
      .filter((c) => c.included !== false)
      .map((c) => ({ kind: "cxblade", id: "cx:" + c.id, name: c.name, comps: c.comps, thumb: cxThumb(c.comps), fused: false }));
    return normal.concat(cx);
  }
  function simplePool(part) {
    return BeyDB.list(part).filter((e) => state.owned[part].has(e.key)).map((e) => ({ kind: part, id: e.key, code: e.key, name: e.name, img: e.img, fused: e.fused }));
  }

  // ===== 拉霸動畫 =====
  function frameHTML(item, full) {
    if (!item) return `<div class="frame"><span style="color:#6b7c97;font-size:22px">—</span></div>`;
    if (item.kind === "cxblade") {
      return full ? `<div class="frame">${cxStackHTML(item.comps)}</div>` : `<div class="frame"><img src="${item.thumb}" alt=""></div>`;
    }
    return `<div class="frame"><img src="${item.img}" alt=""></div>`;
  }

  // 回傳 Promise，於該 reel 停定時 resolve
  function spinReel(reelEl, pool, finalItem, durationMs) {
    const strip = reelEl.querySelector(".reel-strip");
    reelEl.classList.remove("pop");
    if (!finalItem) { strip.innerHTML = frameHTML(null, true); strip.style.transition = "none"; strip.style.transform = "translateY(0)"; return Promise.resolve(); }
    const fillers = Array.from({ length: FILLERS }, () => frameHTML(pool.length ? rnd(pool) : finalItem, false)).join("");
    strip.innerHTML = fillers + frameHTML(finalItem, true);
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        strip.style.transition = `transform ${durationMs}ms cubic-bezier(0.10, 0.62, 0.18, 1)`;
        strip.style.transform = `translateY(-${FILLERS * CELL}px)`;
        let done = false;
        const finish = () => { if (done) return; done = true; reelEl.classList.add("pop"); resolve(); };
        strip.addEventListener("transitionend", finish, { once: true });
        setTimeout(finish, durationMs + 120); // 保險：transitionend 萬一沒觸發
      }));
    });
  }

  // 從 pool 抽一個；noDup 開啟時盡量避開本批已用過的(池子夠大才避，不夠就允許重複)
  function pickPart(pool, used, noDup) {
    let arr = pool;
    if (noDup && used && pool.length > used.size) {
      const fresh = pool.filter((p) => !used.has(p.id));
      if (fresh.length) arr = fresh;
    }
    return arr.length ? rnd(arr) : null;
  }
  function pickCombo(pools, used) {
    const blade = pickPart(pools.blade, used && used.blade, state.noDup);
    const bladeFused = blade && blade.fused;
    // 合體型上蓋：固鎖/軸心一體，皆留空
    const bit = bladeFused ? null : pickPart(pools.bit, used && used.bit, state.noDupBit);
    // 組合(合體)軸心：與固鎖一體，抽到時不需固鎖
    const bitFused = bit && bit.fused;
    const ratchet = (bladeFused || bitFused) ? null : pickPart(pools.ratchet, used && used.ratchet, state.noDupRatchet);
    return { blade, ratchet, bit };
  }
  // 把一顆 combo 的各部件記入「本批已用」集合
  function markUsed(used, c) {
    if (c.blade) used.blade.add(c.blade.id);
    if (c.ratchet) used.ratchet.add(c.ratchet.id);
    if (c.bit) used.bit.add(c.bit.id);
  }
  function emptyUsed() { return { blade: new Set(), ratchet: new Set(), bit: new Set() }; }

  function topCardHTML(idx) {
    return `<div class="top-card" data-idx="${idx}">
      <span class="top-no">#${idx + 1}</span>
      <div class="reels">
        <div class="reel" data-part="blade"><div class="reel-strip"></div></div>
        <div class="reel" data-part="ratchet"><div class="reel-strip"></div></div>
        <div class="reel" data-part="bit"><div class="reel-strip"></div></div>
      </div>
      <div class="top-meta">
        <div class="top-name"></div>
        <button type="button" class="reroll-one">🎲 重抽這顆</button>
      </div>
    </div>`;
  }

  function revealMeta(cardEl, combo) {
    const { blade, ratchet, bit } = combo;
    // 僅顯示完整陀螺名稱：上蓋用中文名，固鎖／軸心用代碼(key)，例「蝙蝠4-55LR」
    const name = (blade ? blade.name : "") + (ratchet ? ratchet.code : "") + (bit ? bit.code : "");
    cardEl.querySelector(".top-name").textContent = name || "（空）";
  }

  async function animateCard(cardEl, combo, pools, topIdx) {
    const base = 1200 + topIdx * 180;
    const reels = {
      blade: cardEl.querySelector('.reel[data-part="blade"]'),
      ratchet: cardEl.querySelector('.reel[data-part="ratchet"]'),
      bit: cardEl.querySelector('.reel[data-part="bit"]'),
    };
    cardEl.querySelector(".top-name").textContent = "";
    // 三格同時起跑，依序定格（上蓋→軸心→固鎖）
    const pBlade = spinReel(reels.blade, pools.blade, combo.blade, base);
    const pRatchet = spinReel(reels.ratchet, pools.ratchet, combo.ratchet, base + 450);
    const pBit = spinReel(reels.bit, pools.bit, combo.bit, base + 900);
    await Promise.all([pBlade, pRatchet, pBit]);
    revealMeta(cardEl, combo);
  }

  let busy = false;
  async function generate() {
    if (busy) return;
    const pools = { blade: bladePool(), ratchet: simplePool("ratchet"), bit: simplePool("bit") };
    if (!pools.blade.length) { toast("請先在下方「上蓋」勾選你擁有的上蓋（或組裝 CX 上蓋）", true); return; }
    if (!pools.ratchet.length || !pools.bit.length) {
      toast("提示：未勾選固鎖／軸心，非合體型上蓋會留空", false);
    }
    busy = true;
    $("genBtn").disabled = true;
    $("resultHint").style.display = "none";

    const used = emptyUsed();
    const combos = [];
    for (let i = 0; i < state.count; i++) {
      const c = pickCombo(pools, used);
      markUsed(used, c);
      combos.push(c);
    }

    const row = $("reelRow");
    row.innerHTML = combos.map((_, i) => topCardHTML(i)).join("");
    const cards = [...row.querySelectorAll(".top-card")];
    cards.forEach((card, i) => {
      card.querySelector(".reroll-one").addEventListener("click", () => rerollOne(i));
    });
    // 保存目前 pools/combos 供重抽用
    row._pools = pools; row._combos = combos;

    await Promise.all(cards.map((card, i) => animateCard(card, combos[i], pools, i)));
    busy = false;
    $("genBtn").disabled = false;
  }

  async function rerollOne(idx) {
    if (busy) return;
    const row = $("reelRow");
    const pools = row._pools, combos = row._combos;
    if (!pools) return;
    busy = true; $("genBtn").disabled = true;
    const used = emptyUsed();
    combos.forEach((c, i) => { if (i !== idx) markUsed(used, c); });
    const c = pickCombo(pools, used);
    combos[idx] = c;
    const card = row.querySelectorAll(".top-card")[idx];
    await animateCard(card, c, pools, 0);
    busy = false; $("genBtn").disabled = false;
  }

  // ===== UI 綁定 =====
  function syncTabsUI() {
    document.querySelectorAll(".inv-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  }

  function bind() {
    // 顆數
    $("countPick").querySelectorAll(".count-btn").forEach((b) =>
      b.addEventListener("click", () => {
        state.count = Number(b.dataset.count);
        $("countPick").querySelectorAll(".count-btn").forEach((x) => x.classList.toggle("active", x === b));
        save();
      })
    );
    $("countPick").querySelectorAll(".count-btn").forEach((b) => b.classList.toggle("active", Number(b.dataset.count) === state.count));

    $("noDup").checked = state.noDup;
    $("noDup").addEventListener("change", (e) => { state.noDup = e.target.checked; save(); });
    $("noDupRatchet").checked = state.noDupRatchet;
    $("noDupRatchet").addEventListener("change", (e) => { state.noDupRatchet = e.target.checked; save(); });
    $("noDupBit").checked = state.noDupBit;
    $("noDupBit").addEventListener("change", (e) => { state.noDupBit = e.target.checked; save(); });

    $("genBtn").addEventListener("click", generate);

    // 庫存主分頁
    document.querySelectorAll(".inv-tab").forEach((t) =>
      t.addEventListener("click", () => {
        state.tab = t.dataset.tab;
        syncTabsUI();
        renderSystems();
        renderGrid();
      })
    );

    $("invSearch").addEventListener("input", (e) => { state.search = e.target.value; renderGrid(); });
    document.querySelectorAll(".bulk-btn").forEach((b) => b.addEventListener("click", () => bulk(b.dataset.bulk)));

    // CX 組裝器
    $("cxAddBtn").addEventListener("click", () => openCx(null));
    $("cxClose").addEventListener("click", closeCx);
    $("cxModal").addEventListener("click", (e) => { if (e.target.id === "cxModal") closeCx(); });
    document.querySelectorAll(".cx-mode-btn").forEach((b) =>
      b.addEventListener("click", () => {
        cxDraft.mode = Number(b.dataset.mode);
        document.querySelectorAll(".cx-mode-btn").forEach((x) => x.classList.toggle("active", x === b));
        renderCxBuilder();
      })
    );
    $("cxName").addEventListener("input", () => { cxDraft.nameTouched = true; });
    $("cxSave").addEventListener("click", saveCx);

    // 版本更新紀錄
    const clModal = $("changelogModal");
    $("btnChangelog").addEventListener("click", () => clModal.classList.remove("hidden"));
    $("btnChangelogClose").addEventListener("click", () => clModal.classList.add("hidden"));
    clModal.addEventListener("click", (e) => { if (e.target.id === "changelogModal") clModal.classList.add("hidden"); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !clModal.classList.contains("hidden")) clModal.classList.add("hidden");
    });
  }

  // ===== boot =====
  load();
  bind();
  syncTabsUI();
  renderSystems();
  renderGrid();
})();
