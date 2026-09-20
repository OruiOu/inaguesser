/* 共通エンジン — 題材に依存しない。題材ごとの設定は config.js、データは data.src.js（→ data.bin）。
   - ひとりで遊ぶ: ローカル完結
   - 対戦モード : PeerJS (WebRTC) でホスト権威型。ホストが正解と進行を管理し、ゲストは推理を送るだけ。
   loader.js が data.bin を復号したあと GAME_START(data) で起動する */
window.GAME_START = (D) => {
  "use strict";

  const CFG = window.GAME_CONFIG;
  const C = D.chars;
  const LISTS = D.lists || D;                 // 旧形式（トップレベルに works/short）にも対応
  const F = CFG.fields;
  const ATTRS = CFG.attrs;
  const $ = (id) => document.getElementById(id);
  const PEER_PREFIX = CFG.id + "-";
  const PLAYER_COLORS = ["#e0a800", "#1e88e5", "#e53976", "#2e9e4f"];
  const MAX_PLAYERS = CFG.maxPlayers || 4;
  const SOLO_MAX = CFG.soloMax || 10;
  const ITEM = CFG.itemLabel || "キャラ";
  const UNIT = CFG.unit || "人";

  // ---------------------------------------------------------------- utils
  const kanaNorm = (s) =>
    String(s || "")
      .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s・･ｰー\-‐]/g, "")
      .toLowerCase();
  const nameOf = (c) => c[F.name];
  const kanaOf = (c) => (F.kana && c[F.kana]) || "";
  const aliasOf = (c) => (F.alias && c[F.alias]) || "";
  const isMain = (c) => !!(F.main && c[F.main]);
  const imgUrl = (c) => (CFG.imageBase && F.image && c[F.image] ? CFG.imageBase + c[F.image] + (CFG.imageExt || "") : "");

  const SEARCH = C.map((c) => ({ n: kanaNorm(nameOf(c)), k: kanaNorm(kanaOf(c)), a: kanaNorm(aliasOf(c)) }));
  const NAME_TO_IDX = new Map(C.map((c, i) => [nameOf(c), i]));

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtClock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
  const randInt = (n) => Math.floor(Math.random() * n);

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("コピーしました"); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("コピーしました"); } catch { toast("コピーできませんでした"); }
      ta.remove();
    }
  }
  function log(msg) {
    const l = $("game-log"); l.prepend(el("div", null, msg));
    while (l.children.length > 30) l.lastChild.remove();
  }

  // ------------------------------------------------------- 題材ごとの文言
  function applyConfigText() {
    document.title = CFG.title;
    $("brand-text").textContent = CFG.title;
    $("hero-kicker").textContent = CFG.kicker || "";
    const h1 = $("hero-title"); h1.innerHTML = "";
    String(CFG.heroTitle || CFG.title).split("\n").forEach((line, i) => { if (i) h1.appendChild(el("br")); h1.appendChild(document.createTextNode(line)); });
    const demo = $("hero-demo"); demo.innerHTML = "";
    const demoStates = ["partial", "hit", "miss", "miss", "hit", "miss"];
    ATTRS.forEach((a, i) => demo.appendChild(el("span", "demo-tile " + (a.type === "set" ? "partial" : demoStates[i % demoStates.length]), a.label + (a.type === "ordinal" ? (i % 2 ? " ▼" : " ▲") : ""))));
    const lead = $("hero-lead"); lead.innerHTML = "";
    lead.appendChild(document.createTextNode(`${ITEM}名を入力すると、`));
    lead.appendChild(el("b", null, ATTRS.map((a) => a.fullLabel || a.label).join("・")));
    lead.appendChild(document.createTextNode("が正解とどれだけ近いか表示されます。少しずつ絞り込んで正解を当ててください。"));
    $("mode-solo-desc").textContent = `ランダムな${ITEM}を${SOLO_MAX}回以内に当てられるか`;
    $("guess-input").placeholder = `${ITEM}名を入力（ひらがな・ニックネームもOK）`;
    if (CFG.qaExample) $("qa-input").placeholder = "例：" + CFG.qaExample;
    // ルール表
    const rb = $("rules-body"); rb.innerHTML = "";
    const chip = (cls, t) => { const s = el("span", "chip " + cls, t); return s; };
    ATTRS.forEach((a) => {
      const tr = el("tr"); tr.appendChild(el("th", null, a.fullLabel || a.label));
      const td = el("td");
      if (a.type === "set") { td.append(chip("hit", "🟩"), " すべて一致 ／ ", chip("partial", "🟨"), " 1つ以上共通 ／ ", chip("miss", "⬜"), " 共通なし"); }
      else if (a.type === "ordinal") { td.append(chip("hit", "🟩"), " 一致 ／ ", chip("miss", "▲"), " " + (a.up || "正解はもっと上"), " ／ ", chip("miss", "▼"), " " + (a.down || "正解はもっと下")); }
      else { td.append(chip("hit", "🟩"), " 一致 ／ ", chip("miss", "⬜"), " 不一致"); }
      tr.appendChild(td); rb.appendChild(tr);
    });
    const notes = $("rules-notes"); notes.innerHTML = "";
    (CFG.notes || []).forEach((n) => notes.appendChild(el("p", "note", n)));
    const solo = el("p", "note"); solo.appendChild(el("b", null, "ひとりで遊ぶ：")); solo.appendChild(document.createTextNode(`推理できるのは${SOLO_MAX}回まで。${SOLO_MAX}回以内に当てられないと正解が公開されます。`)); notes.appendChild(solo);
    const vsn = el("p", "note"); vsn.appendChild(el("b", null, "対戦モード：")); vsn.appendChild(document.createTextNode(`ホストがルームを作ってコードを友達に伝えます。【ランダムモード】全員同じ正解${ITEM}を順番に1手ずつ推理し、先に当てた人の勝ち。【お題モード】ホストが選んだ${ITEM}を回答者が順番に推理。当てた人の勝ち、規定ターン以内に誰も当てられなければ出題者の勝ち。【質問モード】ホストが選んだ${ITEM}について、回答者が自由に質問し、出題者は「はい／部分的にはい／わからない／部分的にいいえ／いいえ」で答えます。質問回数と回答（${ITEM}名を答える）回数は開始時に決めた回数まで。当てた人の勝ち、回答回数を使い切ったら出題者の勝ち。各手番には制限時間があります。`)); notes.appendChild(vsn);
    // フッター
    const foot = $("foot"); foot.innerHTML = "";
    foot.appendChild(document.createTextNode(CFG.credit || ""));
    if (CFG.creditLink) { const a = el("a", null, CFG.creditLink.label); a.href = CFG.creditLink.url; a.target = "_blank"; a.rel = "noopener"; foot.append(" ", a, " "); }
    foot.appendChild(document.createTextNode(CFG.creditTail || ""));
    if (CFG.support && CFG.support.url) { const p = el("p", "support"); const a = el("a", "btn small", CFG.support.label || "開発者を応援する"); a.href = CFG.support.url; a.target = "_blank"; a.rel = "noopener"; p.appendChild(a); if (CFG.support.note) p.appendChild(el("span", "muted", CFG.support.note)); foot.appendChild(p); }
    // 難易度・フィルター
    $("difficulty-field").hidden = !CFG.difficulty;
    if (CFG.difficulty) { $("diff-main-label").textContent = CFG.difficulty.mainLabel; $("diff-main-note").textContent = CFG.difficulty.mainNote || ""; $("diff-all-label").textContent = CFG.difficulty.allLabel; $("diff-all-note").textContent = CFG.difficulty.allNote || ""; }
    $("filter-field").hidden = !CFG.filter;
    if (CFG.filter) $("filter-label").textContent = CFG.filter.label;
  }

  // ------------------------------------------------------------- settings
  const SETTINGS_KEY = CFG.id + ".settings.v1";
  const filterOptions = CFG.filter ? LISTS[CFG.filter.options] : [];
  let settings = { difficulty: CFG.difficulty ? "main" : "all", filter: filterOptions.map(() => true) };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && Array.isArray(saved.filter) && saved.filter.length === filterOptions.length) settings = saved;
  } catch {}
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} }

  function poolIndices(s) {
    const out = [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (CFG.filter && !s.filter[c[CFG.filter.key]]) continue;
      if (CFG.difficulty && s.difficulty === "main" && !isMain(c)) continue;
      out.push(i);
    }
    return out;
  }
  const difficultyLabel = (s) => (CFG.difficulty ? (s.difficulty === "main" ? CFG.difficulty.mainLabel : CFG.difficulty.allLabel) : "全" + ITEM);

  function buildSettingsUI() {
    const grid = $("works-checks"); grid.innerHTML = "";
    if (CFG.filter) {
      filterOptions.forEach((w, i) => {
        const lab = el("label");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = !!settings.filter[i];
        cb.addEventListener("change", () => { settings.filter[i] = cb.checked; saveSettings(); updatePoolCount(); });
        lab.appendChild(cb); lab.appendChild(el("span", null, CFG.filter.optionLabel ? CFG.filter.optionLabel(w) : w));
        grid.appendChild(lab);
      });
    }
    document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
      r.checked = r.value === settings.difficulty;
      r.addEventListener("change", () => { if (r.checked) { settings.difficulty = r.value; saveSettings(); updatePoolCount(); } });
    });
    updatePoolCount();
  }
  function updatePoolCount() {
    const n = poolIndices(settings).length;
    $("pool-count").textContent = n ? `現在の出題候補：${n}${UNIT}` : "出題候補が0です。範囲を広げてください。";
  }

  // -------------------------------------------------------------- compare
  // 戻り値: { [attr.key]: {s:"hit"|"partial"|"miss", arrow?:"up"|"down", same?:[]} }
  function compare(gi, ai) {
    const g = C[gi], a = C[ai], r = {};
    for (const at of ATTRS) {
      const gv = g[at.key], av = a[at.key];
      if (at.type === "set") {
        const ga = gv || [], aa = av || [];
        const aset = new Set(aa); const same = ga.filter((t) => aset.has(t));
        r[at.key] = { s: ga.length === aa.length && same.length === ga.length ? "hit" : same.length ? "partial" : "miss", same };
      } else if (at.type === "ordinal") {
        const go = at.orderKey ? g[at.orderKey] : gv, ao = at.orderKey ? a[at.orderKey] : av;
        const hit = gv === av;
        r[at.key] = { s: hit ? "hit" : "miss", arrow: hit ? null : go != null && ao != null && go !== ao ? (ao > go ? "up" : "down") : null };
      } else {
        r[at.key] = { s: gv === av ? "hit" : "miss" };
      }
    }
    return r;
  }
  const ARROW = { up: "▲", down: "▼" };
  const EMOJI = { hit: "🟩", partial: "🟨", miss: "⬜" };
  function rowEmoji(r) {
    return ATTRS.map((a) => { const x = r[a.key]; return x.s === "hit" ? "🟩" : x.arrow === "up" ? "⬆️" : x.arrow === "down" ? "⬇️" : EMOJI[x.s]; }).join("");
  }
  // 表示用の値
  function displayValue(at, c) {
    const v = c[at.key];
    if (at.type === "set") return (v && v.length) ? v.join(" / ") : (at.empty || "なし");
    if (at.labels) return LISTS[at.labels][v] ?? String(v);
    return v == null ? "-" : String(v);
  }
  function displayFull(at, c) {
    const v = c[at.key];
    if (at.type === "set") return (v && v.length) ? v.join(" / ") : (at.empty || "なし");
    if (at.fullLabels) return LISTS[at.fullLabels][v] ?? String(v);
    return displayValue(at, c);
  }

  // ---------------------------------------------------------------- board
  function tile(label, state, content, arrow, wide) {
    const t = el("div", "tile " + state + (wide ? " wide" : ""));
    t.appendChild(el("span", "tl", label));
    const v = el("span", "tv");
    if (typeof content === "string") v.textContent = content; else v.appendChild(content);
    if (arrow) v.appendChild(el("span", "arrow", ARROW[arrow]));
    t.appendChild(v);
    return t;
  }
  function renderGuessRow(gi, r, by, isNew) {
    const c = C[gi];
    const card = el("article", "gcard" + (isNew ? " new" : ""));
    const head = el("header", "gcard-head");
    const url = imgUrl(c);
    if (url) { const img = el("img", "gcard-img"); img.alt = ""; img.loading = "lazy"; img.src = url; img.onerror = () => img.classList.add("none"); head.appendChild(img); }
    const nm = el("div", "gcard-name"); nm.appendChild(el("span", "nm", nameOf(c))); if (kanaOf(c)) nm.appendChild(el("span", "kn", kanaOf(c))); head.appendChild(nm);
    if (by) { const b = el("span", "gcard-by", by.name); b.style.setProperty("--c", by.color); head.appendChild(b); }
    card.appendChild(head);

    const tiles = el("div", "tiles");
    for (const at of ATTRS) {
      const x = r[at.key];
      let content;
      if (at.type === "set") {
        const v = c[at.key] || [];
        content = el("span");
        if (v.length) v.forEach((t) => content.appendChild(el("span", "t" + (x.same.includes(t) ? " same" : ""), t)));
        else content.textContent = at.empty || "なし";
      } else content = displayValue(at, c);
      tiles.appendChild(tile(at.label, x.s, content, x.arrow, !!at.wide));
    }
    card.appendChild(tiles);
    return card;
  }
  function clearBoard() { $("board-body").innerHTML = ""; $("board-empty").hidden = false; }
  function appendRow(tr) { $("board-body").prepend(tr); $("board-empty").hidden = true; }

  // -------------------------------------------------------------- suggest
  let activeSuggest = -1;
  let suggestItems = [];
  function excludedGuesses() {
    if (game.mode === "solo") return new Set(game.guesses.map((g) => g.idx).concat(game.hint >= 0 ? [game.hint] : []));
    if (game.mode === "versus" && vs.pub) return new Set(vs.pub.guesses.map((g) => g.idx).concat(vs.pub.hint >= 0 ? [vs.pub.hint] : []));
    return new Set();
  }
  function searchChars(q, ex) {
    const nq = kanaNorm(q);
    if (!nq) return [];
    ex = ex || excludedGuesses();
    const starts = [], contains = [];
    for (let i = 0; i < C.length; i++) {
      if (ex.has(i)) continue;
      const s = SEARCH[i];
      if (s.n.startsWith(nq) || s.k.startsWith(nq) || s.a.startsWith(nq)) starts.push(i);
      else if (s.n.includes(nq) || s.k.includes(nq) || s.a.includes(nq)) contains.push(i);
    }
    const byMain = (a, b) => (isMain(C[b]) - isMain(C[a])) || a - b;
    starts.sort(byMain); contains.sort(byMain);
    return starts.concat(contains).slice(0, 40);
  }
  function renderSuggest() {
    const ul = $("suggest");
    const q = $("guess-input").value;
    suggestItems = searchChars(q);
    ul.innerHTML = "";
    if (!q.trim()) { ul.hidden = true; return; }
    if (!suggestItems.length) ul.appendChild(el("li", "s-empty", `該当する${ITEM}がいません`));
    else suggestItems.forEach((i, k) => {
      const c = C[i];
      const li = el("li", k === activeSuggest ? "active" : "");
      li.appendChild(el("span", "s-name", nameOf(c)));
      if (kanaOf(c)) li.appendChild(el("span", "s-kana", kanaOf(c)));
      if (CFG.suggestSub) li.appendChild(el("span", "s-team", CFG.suggestSub(c)));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); submitGuess(i); });
      ul.appendChild(li);
    });
    ul.hidden = false;
  }
  function hideSuggest() { $("suggest").hidden = true; activeSuggest = -1; }
  // 汎用サジェスト（お題選択用）。onPick(idx) を呼ぶ
  function attachSuggest(input, ul, onPick) {
    let items = [], active = -1;
    const render = () => {
      const q = input.value; items = searchChars(q, new Set()); ul.innerHTML = "";
      if (!q.trim()) { ul.hidden = true; return; }
      if (!items.length) ul.appendChild(el("li", "s-empty", `該当する${ITEM}がいません`));
      else items.forEach((i, k) => {
        const c = C[i]; const li = el("li", k === active ? "active" : "");
        li.appendChild(el("span", "s-name", nameOf(c)));
        if (kanaOf(c)) li.appendChild(el("span", "s-kana", kanaOf(c)));
        if (CFG.suggestSub) li.appendChild(el("span", "s-team", CFG.suggestSub(c)));
        li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
        ul.appendChild(li);
      });
      ul.hidden = false;
    };
    const hide = () => { ul.hidden = true; active = -1; };
    const pick = (i) => { input.value = ""; hide(); onPick(i); };
    input.addEventListener("input", () => { active = -1; render(); });
    input.addEventListener("focus", render);
    input.addEventListener("blur", () => setTimeout(hide, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; render(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; render(); } }
      else if (e.key === "Enter") { e.preventDefault(); const q = input.value.trim(); const i = active >= 0 ? items[active] : NAME_TO_IDX.has(q) ? NAME_TO_IDX.get(q) : items.length === 1 ? items[0] : -1; if (i >= 0) pick(i); else toast(`候補から${ITEM}を選んでください`); }
      else if (e.key === "Escape") hide();
    });
  }
  function resolveInputToIdx() {
    const q = $("guess-input").value.trim();
    if (!q) return -1;
    if (activeSuggest >= 0 && suggestItems[activeSuggest] != null) return suggestItems[activeSuggest];
    if (NAME_TO_IDX.has(q)) return NAME_TO_IDX.get(q);
    const nq = kanaNorm(q);
    const exact = suggestItems.filter((i) => SEARCH[i].n === nq || SEARCH[i].k === nq || SEARCH[i].a === nq);
    if (exact.length === 1) return exact[0];
    if (suggestItems.length === 1) return suggestItems[0];
    return -1;
  }

  // ------------------------------------------------------------ game state
  const game = { mode: null, answer: -1, hint: -1, guesses: [], over: false };
  // 本家と同じく、開始時に正解以外を1つランダムに開示する
  function pickHint(pool, answer) {
    if (pool.length < 2) return -1;
    let h; do { h = pool[randInt(pool.length)]; } while (h === answer);
    return h;
  }
  function showHintRow(hintIdx, answerIdx) {
    if (hintIdx < 0) return;
    appendRow(renderGuessRow(hintIdx, compare(hintIdx, answerIdx), null, false));
  }
  function setRemaining(n) {
    const p = $("remain-pill");
    if (n == null) { p.hidden = true; return; }
    p.hidden = false; p.innerHTML = "";
    p.appendChild(el("span", "rl", "残り")); p.appendChild(el("b", null, String(n))); p.appendChild(el("span", "rl", "回"));
    p.classList.toggle("low", n <= 3);
  }
  let timerHandle = null;

  function setInputEnabled(on, placeholder) {
    $("guess-input").disabled = !on;
    $("guess-button").disabled = !on;
    if (placeholder) $("guess-input").placeholder = placeholder;
  }

  function submitGuess(idx) {
    if (idx == null || idx < 0) {
      idx = resolveInputToIdx();
      if (idx < 0) { toast(`候補から${ITEM}を選んでください`); return; }
    }
    $("guess-input").value = "";
    hideSuggest();
    if (game.mode === "solo") soloGuess(idx);
    else if (game.mode === "versus") versusGuess(idx);
  }

  // ------------------------------------------------------------------ solo
  function startSolo() {
    const pool = poolIndices(settings);
    if (!pool.length) { toast("出題候補が0です。設定を確認してください"); return; }
    game.mode = "solo"; game.answer = pool[randInt(pool.length)]; game.guesses = []; game.over = false;
    game.hint = pickHint(pool, game.answer);
    showScreen("game");
    $("game-mode-label").textContent = "ひとりで遊ぶ";
    $("game-sub").textContent = `${difficultyLabel(settings)}・候補 ${pool.length}${UNIT}`;
    setRemaining(SOLO_MAX);
    $("turn-box").hidden = true; $("game-players").hidden = true;
    $("btn-surrender").hidden = false;
    $("game-log").innerHTML = "";
    clearBoard();
    showHintRow(game.hint, game.answer);
    setInputEnabled(true, `${ITEM}名を入力（ひらがな・ニックネームもOK）`);
    $("guess-input").focus();
  }
  function soloGuess(idx) {
    if (game.over) return;
    if (game.guesses.some((g) => g.idx === idx)) { toast(`すでに推理した${ITEM}です`); return; }
    const r = compare(idx, game.answer);
    game.guesses.push({ idx, r });
    appendRow(renderGuessRow(idx, r, null, true));
    $("game-sub").textContent = `${game.guesses.length}手目`;
    setRemaining(SOLO_MAX - game.guesses.length);
    if (idx === game.answer) {
      game.over = true; setInputEnabled(false);
      showResult({ verdict: `${game.guesses.length}手で正解！`, cls: "win", answer: game.answer, share: soloShareText() });
    } else if (game.guesses.length >= SOLO_MAX) {
      game.over = true; setInputEnabled(false, "回数切れ");
      showResult({ verdict: `${SOLO_MAX}回以内に当てられず…`, cls: "lose", answer: game.answer, share: soloShareText(false, true) });
    }
  }
  function soloSurrender() {
    if (game.over) return;
    game.over = true; setInputEnabled(false);
    showResult({ verdict: "降参…", cls: "lose", answer: game.answer, share: soloShareText(true) });
  }
  function soloShareText(gaveUp, failed) {
    const head = gaveUp ? `${game.guesses.length}手で降参` : failed ? `${SOLO_MAX}回以内に当てられず` : `${game.guesses.length}手で正解！`;
    return [`${CFG.title}｜ひとりで遊ぶ`, `${head}（${difficultyLabel(settings)}）`, ...game.guesses.map((g) => rowEmoji(g.r))].join("\n");
  }

  // ---------------------------------------------------------------- result
  let lastResult = null;
  function showResult(res) {
    lastResult = res;
    const c = C[res.answer];
    const v = $("result-verdict"); v.textContent = res.verdict; v.className = "result-verdict " + (res.cls || "");
    const img = $("result-img"); const url = imgUrl(c);
    img.className = url ? "" : "none"; img.src = url || ""; img.alt = nameOf(c);
    img.onerror = () => { img.className = "none"; };
    $("result-title").textContent = nameOf(c); $("result-kana").textContent = kanaOf(c);
    const dl = $("result-attrs"); dl.innerHTML = "";
    ATTRS.forEach((at) => { dl.appendChild(el("dt", null, at.fullLabel || at.label)); dl.appendChild(el("dd", null, displayFull(at, c))); });
    $("btn-copy-result").hidden = !res.share;
    const topicVs = game.mode === "versus" && vs.pub && hasSetter(vs.pub.mode);
    $("btn-again").textContent = game.mode === "versus" ? (vs.isHost ? (topicVs ? "次のお題を選ぶ" : "もう一度（同じメンバー）") : "ホストの再戦を待つ") : "もう一度";
    $("btn-again").disabled = game.mode === "versus" && !vs.isHost;
    $("btn-swap-setter").hidden = !(topicVs && vs.isHost && vs.pub.players.filter((p) => p.connected).length > 1);
    $("result-modal").hidden = false;
  }
  function hideResult() { $("result-modal").hidden = true; }

  // --------------------------------------------------------------- screens
  function showScreen(name) {
    ["home", "lobby", "game"].forEach((s) => ($("screen-" + s).hidden = s !== name));
    hideSuggest();
    window.scrollTo(0, 0);
  }
  function goHome() {
    if (game.mode === "versus") leaveVersus();
    game.mode = null; game.over = false;
    stopTimer(); hideResult();
    $("topbar-status").textContent = "";
    showScreen("home");
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  // ---------------------------------------------------------------- versus
  const vs = { peer: null, isHost: false, code: null, conn: null, host: null, pub: null, me: -1, deadlineLocal: null, name: "", myTopic: -1 };
  const NICK_KEY = CFG.id + ".nick";
  try { vs.name = localStorage.getItem(NICK_KEY) || ""; } catch {}

  function myNick() {
    const n = $("nickname").value.trim() || "プレイヤー";
    vs.name = n; try { localStorage.setItem(NICK_KEY, n); } catch {}
    return n;
  }
  function peerAvailable() { return typeof window.Peer === "function"; }
  function lobbyStatus(msg) { $("lobby-status").textContent = msg || ""; }

  function openLobby(prefillCode) {
    showScreen("lobby");
    $("nickname").value = vs.name;
    $("lobby-choice").hidden = false; $("lobby-room").hidden = true;
    $("join-code").value = prefillCode || "";
    lobbyStatus(peerAvailable() ? "" : "通信ライブラリを読み込めませんでした。ネットワーク環境を確認するか、公開版のURLから開いてください。");
  }
  // PeerJS の公開シグナリングサーバー + 既定の STUN/TURN を使用
  function makePeer(id) { return new Peer(id, { debug: 1 }); }

  // ---- host
  function createRoom() {
    if (!peerAvailable()) { toast("通信ライブラリが読み込めていません"); return; }
    const pool = poolIndices(settings);
    if (!pool.length) { toast("出題候補が0です。ホームの設定を確認してください"); return; }
    const name = myNick();
    lobbyStatus("ルームを作成中…");
    $("btn-create-room").disabled = true;
    tryHostCode(0, name);
  }
  function tryHostCode(attempt, name) {
    const code = String(100000 + randInt(900000));
    const peer = makePeer(PEER_PREFIX + code);
    let settled = false;
    peer.on("open", () => {
      settled = true;
      vs.peer = peer; vs.isHost = true; vs.code = code; vs.me = 0;
      const mode = selectedVsMode();
      vs.host = {
        players: [{ name, conn: null, connected: true, out: false }],
        status: "lobby",
        mode,
        settings: { difficulty: settings.difficulty, filter: settings.filter.slice() },
        opts: { turnSec: +$("turn-seconds").value, maxTurns: mode === "qa" ? 0 : +$("max-turns").value, qMax: +$("qa-questions").value, gMax: +$("qa-guesses").value },
        answer: -1, hint: -1, guesses: [], turn: 0, turnNo: 1, deadline: null, winner: null, reason: null, events: [],
        setter: 0,   // 出題者（お題・質問モード）。ロビーで交代できる
        // 質問モード
        qa: [], qLeft: 0, gLeft: 0, phase: "ask",   // qa: [{k:"q",p,q,a} | {k:"g",p,idx,ok}] を時系列で
      };
      peer.on("connection", onHostConnection);
      peer.on("disconnected", () => { lobbyStatus("シグナリングサーバーから切断されました。再接続中…"); try { peer.reconnect(); } catch {} });
      peer.on("error", (e) => { console.warn(e); if (e.type !== "peer-unavailable") toast("通信エラー: " + e.type); });
      $("btn-create-room").disabled = false;
      enterRoomView();
      hostBroadcast();
    });
    peer.on("error", (e) => {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch {}
      if (e.type === "unavailable-id" && attempt < 5) { tryHostCode(attempt + 1, name); return; }
      $("btn-create-room").disabled = false;
      lobbyStatus("ルームを作成できませんでした（" + e.type + "）。時間をおいて再度お試しください。");
    });
  }
  function onHostConnection(conn) {
    conn.on("open", () => {
      conn.on("data", (msg) => hostOnMessage(conn, msg));
      conn.on("close", () => hostOnLeave(conn));
      conn.on("error", () => hostOnLeave(conn));
    });
  }
  function hostSend(conn, msg) { try { conn.send(msg); } catch {} }
  function hostOnMessage(conn, msg) {
    const H = vs.host; if (!H || !msg || typeof msg !== "object") return;
    const pIdx = H.players.findIndex((p) => p.conn === conn);
    if (msg.t === "join") {
      if (pIdx >= 0) return;
      if (H.status !== "lobby") { hostSend(conn, { t: "error", msg: "対戦中のため参加できません。次のゲームまでお待ちください。" }); return; }
      if (H.players.filter((p) => p.connected).length >= MAX_PLAYERS) { hostSend(conn, { t: "error", msg: "満員です（最大" + MAX_PLAYERS + "人）" }); return; }
      const name = String(msg.name || "プレイヤー").slice(0, 12);
      H.players.push({ name, conn, connected: true, out: false });
      hostSend(conn, { t: "welcome", you: H.players.length - 1 });
      hostEvent(`${name} が参加しました`);
      hostBroadcast();
      return;
    }
    if (pIdx < 0) return;
    if (msg.t === "guess") hostGuess(pIdx, msg.idx | 0);
    else if (msg.t === "ask") hostAsk(pIdx, msg.q);
    else if (msg.t === "topic") { if (pIdx === H.setter) hostSetTopic(msg.idx | 0); }
    else if (msg.t === "answer") { if (pIdx === H.setter) hostAnswer(msg.k); }
    else if (msg.t === "surrender") hostSurrender(pIdx);
  }
  function hostOnLeave(conn) {
    const H = vs.host; if (!H) return;
    const p = H.players.find((x) => x.conn === conn);
    if (!p || !p.connected) return;
    p.connected = false;
    hostEvent(`${p.name} が切断しました`);
    if (H.status === "lobby") {
      const setterP = H.players[H.setter];
      H.players = H.players.filter((x) => x.connected);
      const si = H.players.indexOf(setterP);
      if (si < 0) { H.setter = 0; H.answer = -1; } else H.setter = si;
      H.players.forEach((x, i) => { if (x.conn) hostSend(x.conn, { t: "welcome", you: i }); });
    }
    else if (H.status === "playing") {
      if (isSetter(H, H.players.indexOf(p))) { finish(null, "setter_left"); hostBroadcast(); return; }
      checkRemaining();
      if (H.status === "playing" && H.turn === H.players.indexOf(p)) advanceTurn(false);
    }
    hostBroadcast();
  }
  function hostEvent(text) { const H = vs.host; H.events.push(text); if (H.events.length > 20) H.events.shift(); }
  // 出題者がいるモード（お題モード・質問モード）。出題者は H.setter（初期はホスト。ロビーで交代できる）
  const hasSetter = (mode) => mode === "topic" || mode === "qa";
  const isSetter = (H, i) => hasSetter(H.mode) && i === H.setter;
  const setterName = (pub) => (pub.players[pub.setter] ? pub.players[pub.setter].name : "出題者");
  const selectedVsMode = () => { const v = (document.querySelector('input[name="vsmode"]:checked') || {}).value; return v === "topic" || v === "qa" ? v : "random"; };
  // 質問モードの回答の種類
  const QA_ANSWERS = [
    { k: "yes", label: "はい" }, { k: "pyes", label: "部分的にはい" }, { k: "unknown", label: "わからない" },
    { k: "pno", label: "部分的にいいえ" }, { k: "no", label: "いいえ" },
  ];
  const qaAnswerLabel = (k) => (QA_ANSWERS.find((a) => a.k === k) || {}).label || "";
  const eligible = (H, i) => { const p = H.players[i]; return !!p && p.connected && !p.out && !isSetter(H, i); };
  function activePlayers() { const H = vs.host; return H.players.filter((p, i) => eligible(H, i)); }

  function hostStart() {
    const H = vs.host;
    const setter = hasSetter(H.mode);
    if (H.players.filter((p) => p.connected).length < 2) { toast(setter ? "回答者が1人以上必要です" : "2人以上で開始できます"); return; }
    if (setter && !(H.answer >= 0)) { toast("お題を選んでください"); return; }
    const pool = poolIndices(H.settings);
    if (!setter && !pool.length) { toast("出題候補が0です"); return; }
    const setterP = H.players[H.setter];
    H.players = H.players.filter((p) => p.connected);
    H.setter = Math.max(0, H.players.indexOf(setterP));   // 切断者を除いた後の番号に付け直す
    H.players.forEach((p, i) => { p.out = false; if (p.conn) hostSend(p.conn, { t: "welcome", you: i }); });
    if (!setter) H.answer = pool[randInt(pool.length)];
    // 質問モードはヒント（初期開示）なし
    H.hint = H.mode === "qa" ? -1 : pickHint(pool.length ? pool : C.map((_, i) => i), H.answer);
    H.guesses = []; H.winner = null; H.reason = null; H.events = [];
    H.qa = []; H.qLeft = H.opts.qMax || 0; H.gLeft = H.opts.gMax || 0; H.phase = "ask";
    H.status = "playing";
    if (setter) { H.turn = H.setter; advanceTurn(false); } else H.turn = randInt(H.players.length);
    H.turnNo = 1;
    H.deadline = H.opts.turnSec ? Date.now() + H.opts.turnSec * 1000 : null;
    hostEvent(H.mode === "qa" ? `対戦開始！ ${H.players[H.setter].name} に質問して、お題の${ITEM}を当てよう（質問${H.qLeft}回・回答${H.gLeft}回まで）`
      : setter ? `対戦開始！ ${H.players[H.setter].name} が出したお題を当てよう` : `対戦開始！ 正解候補 ${pool.length}${UNIT}`);
    hostBroadcast();
  }
  function hostBackToLobby(rotateSetter) {
    const H = vs.host; if (!H) return;
    const curSetter = H.players[H.setter];
    H.status = "lobby"; H.answer = -1; H.hint = -1; H.guesses = []; H.winner = null; H.reason = null; H.events = [];
    H.qa = []; H.phase = "ask";
    H.players = H.players.filter((p) => p.connected); H.players.forEach((p, i) => { p.out = false; if (p.conn) hostSend(p.conn, { t: "welcome", you: i }); });
    let si = Math.max(0, H.players.indexOf(curSetter));
    if (rotateSetter && H.players.length > 1) si = (si + 1) % H.players.length;   // 次の人に交代
    H.setter = si;
    hostBroadcast();
  }
  function hostSetSetter(i) {
    const H = vs.host; if (!H || H.status !== "lobby" || !hasSetter(H.mode)) return;
    if (!(i >= 0 && i < H.players.length)) return;
    if (H.setter !== i) { H.setter = i; H.answer = -1; hostEvent(`出題者が ${H.players[i].name} に交代`); }
    hostBroadcast();
  }
  function hostSetTopic(idx) {
    const H = vs.host; if (!H || H.status !== "lobby") return;
    H.answer = idx >= 0 && idx < C.length ? idx : -1;
    hostBroadcast();
  }
  // 出題者（ホストでもゲストでも）がお題を選ぶ／取り消す
  function pickTopic(idx) {
    if (vs.isHost) { hostSetTopic(idx); return; }
    vs.myTopic = idx >= 0 ? idx : -1;
    if (vs.conn) vs.conn.send({ t: "topic", idx: vs.myTopic });
    renderTopicUI();
  }
  const myTopicIdx = () => (vs.isHost ? (vs.host ? vs.host.answer : -1) : vs.myTopic);
  function renderTopicUI() {
    const H = vs.host, pub = vs.pub;
    const mode = H ? H.mode : pub ? pub.mode : null;
    const setter = H ? H.setter : pub ? pub.setter : -1;
    const status = H ? H.status : pub ? pub.status : null;
    const on = !!mode && hasSetter(mode) && vs.me === setter && status === "lobby";
    $("topic-field").hidden = !on;
    if (!on) return;
    const idx = myTopicIdx(); const chosen = idx >= 0;
    $("topic-picker").hidden = chosen; $("topic-chosen").hidden = !chosen;
    if (chosen) $("topic-name").textContent = nameOf(C[idx]);
  }
  function hostGuess(pIdx, idx) {
    const H = vs.host;
    if (H.status !== "playing" || H.turn !== pIdx || isSetter(H, pIdx)) return;
    if (!(idx >= 0 && idx < C.length)) return;
    const errTo = (msg) => { const p = H.players[pIdx]; if (p.conn) hostSend(p.conn, { t: "error", msg }); else toast(msg); };
    if (H.mode === "qa") {
      // 質問モードの「回答」：タイル判定なし。回数を消費し、使い切ったら出題者の勝ち
      if (H.phase !== "ask") return;
      if (H.gLeft <= 0) { errTo("回答できる回数がもうありません"); return; }
      if (H.qa.some((g) => g.k === "g" && g.idx === idx)) { errTo(`すでに回答された${ITEM}です`); return; }
      const ok = idx === H.answer;
      H.qa.push({ k: "g", p: pIdx, idx, ok });
      H.gLeft--;
      if (ok) finish(pIdx, "correct");
      else {
        hostEvent(`${H.players[pIdx].name} の回答「${nameOf(C[idx])}」は不正解（回答 残り${H.gLeft}回）`);
        if (H.gLeft <= 0) finish(null, "no_guesses");
        else advanceTurn(true);
      }
      hostBroadcast();
      return;
    }
    if (H.guesses.some((g) => g.idx === idx)) { errTo(`すでに推理された${ITEM}です`); return; }
    H.guesses.push({ p: pIdx, idx });
    if (idx === H.answer) finish(pIdx, "correct");
    else advanceTurn(true);
    hostBroadcast();
  }
  // 質問モード：回答者の質問
  function hostAsk(pIdx, q) {
    const H = vs.host;
    if (H.mode !== "qa" || H.status !== "playing" || H.phase !== "ask" || H.turn !== pIdx || isSetter(H, pIdx)) return;
    q = String(q || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!q) return;
    if (H.qLeft <= 0) { const p = H.players[pIdx]; const msg = "質問できる回数がもうありません"; if (p.conn) hostSend(p.conn, { t: "error", msg }); else toast(msg); return; }
    H.qa.push({ k: "q", p: pIdx, q, a: null });
    H.qLeft--;
    H.phase = "answer";
    H.deadline = H.opts.turnSec ? Date.now() + H.opts.turnSec * 1000 : null;
    hostBroadcast();
  }
  // 質問モード：出題者の回答（ホスト自身が操作）
  function hostAnswer(k) {
    const H = vs.host;
    if (!H || H.mode !== "qa" || H.status !== "playing" || H.phase !== "answer") return;
    if (!QA_ANSWERS.some((a) => a.k === k)) return;
    const last = H.qa[H.qa.length - 1]; if (!last || last.k !== "q" || last.a) return;
    last.a = k;
    H.phase = "ask";
    if (H.qLeft <= 0 && H.gLeft > 0) hostEvent(`質問はもう使い切りました。あとは回答（${ITEM}名）だけです`);
    advanceTurn(true);
    hostBroadcast();
  }
  function hostSurrender(pIdx) {
    const H = vs.host;
    if (H.status !== "playing") return;
    const p = H.players[pIdx]; if (!p || p.out || isSetter(H, pIdx)) return;
    p.out = true; hostEvent(`${p.name} が降参しました`);
    checkRemaining();
    if (H.status === "playing" && H.turn === pIdx) advanceTurn(false);
    hostBroadcast();
  }
  function checkRemaining() {
    const H = vs.host;
    const act = activePlayers();
    if (act.length === 0) finish(null, "all_out");
    else if (act.length === 1 && !hasSetter(H.mode)) finish(H.players.indexOf(act[0]), "others_out");
  }
  function advanceTurn(countTurn) {
    const H = vs.host;
    if (countTurn) H.turnNo++;
    if (H.opts.maxTurns && H.turnNo > H.opts.maxTurns) { finish(null, "max_turns"); return; }
    const n = H.players.length;
    for (let k = 1; k <= n; k++) {
      const cand = (H.turn + k) % n;
      if (eligible(H, cand)) { H.turn = cand; break; }
    }
    H.deadline = H.opts.turnSec ? Date.now() + H.opts.turnSec * 1000 : null;
  }
  function finish(winner, reason) { const H = vs.host; H.status = "finished"; H.winner = winner; H.reason = reason; H.deadline = null; }
  function hostTick() {
    const H = vs.host;
    if (!H || H.status !== "playing" || !H.deadline) return;
    if (Date.now() < H.deadline) return;
    if (H.mode === "qa" && H.phase === "answer") { hostEvent(`${H.players[H.setter].name} が時間内に答えなかったので「わからない」扱い`); hostAnswer("unknown"); return; }
    hostEvent(`${H.players[H.turn].name} は時間切れ`); advanceTurn(true); hostBroadcast();
  }
  function publicState() {
    const H = vs.host;
    return {
      status: H.status, mode: H.mode, topicChosen: H.answer >= 0, setter: H.setter,
      players: H.players.map((p) => ({ name: p.name, connected: p.connected, out: p.out })),
      settings: H.settings, opts: H.opts,
      guesses: H.guesses.map((g) => ({ p: g.p, idx: g.idx, r: compare(g.idx, H.answer) })),
      turn: H.turn, turnNo: H.turnNo, now: Date.now(), deadline: H.deadline,
      winner: H.winner, reason: H.reason, events: H.events,
      answer: H.status === "finished" ? H.answer : -1,
      hint: H.hint, hintR: H.hint >= 0 ? compare(H.hint, H.answer) : null,
      // 質問モード
      qa: H.qa, qLeft: H.qLeft, gLeft: H.gLeft, phase: H.phase,
    };
  }
  function hostBroadcast() {
    const H = vs.host; if (!H) return;
    const pub = publicState();
    H.players.forEach((p) => { if (p.conn && p.connected) hostSend(p.conn, { t: "state", s: pub }); });
    applyState(pub);
  }

  // ---- guest
  function joinRoom() {
    if (!peerAvailable()) { toast("通信ライブラリが読み込めていません"); return; }
    const code = $("join-code").value.replace(/\D/g, "");
    if (code.length !== 6) { toast("6桁のコードを入力してください"); return; }
    const name = myNick();
    lobbyStatus("ルームに接続中…");
    $("btn-join-room").disabled = true;
    const peer = makePeer(undefined);
    let joined = false;
    const fail = (msg) => { if (joined) return; joined = true; $("btn-join-room").disabled = false; lobbyStatus(msg); try { peer.destroy(); } catch {} };
    const timeout = setTimeout(() => fail("ホストに接続できませんでした。コードを確認してください。"), 15000);
    peer.on("open", () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      conn.on("open", () => {
        clearTimeout(timeout); joined = true;
        vs.peer = peer; vs.conn = conn; vs.isHost = false; vs.code = code;
        $("btn-join-room").disabled = false;
        conn.send({ t: "join", name });
        conn.on("data", guestOnMessage);
        conn.on("close", () => onHostLost());
        conn.on("error", () => onHostLost());
        enterRoomView();
      });
    });
    peer.on("error", (e) => {
      clearTimeout(timeout);
      if (e.type === "peer-unavailable") fail("そのコードのルームが見つかりません。");
      else fail("接続エラー: " + e.type);
    });
  }
  function guestOnMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "welcome") vs.me = msg.you | 0;
    else if (msg.t === "state") applyState(msg.s);
    else if (msg.t === "error") { toast(msg.msg || "エラー"); lobbyStatus(msg.msg || ""); }
  }
  function onHostLost() {
    if (!vs.peer) return;
    toast("ホストとの接続が切れました");
    if (game.mode === "versus" && vs.pub && vs.pub.status === "playing") { log("ホストとの接続が切れました。ゲームを終了します。"); setInputEnabled(false); stopTimer(); $("turn-who").textContent = "接続終了"; $("turn-timer").textContent = ""; }
    else { leaveVersus(); openLobby(); lobbyStatus("ホストとの接続が切れました。"); }
  }

  // ---- shared
  function enterRoomView() {
    $("lobby-choice").hidden = true; $("lobby-room").hidden = false;
    $("room-code-display").textContent = vs.code;
    $("btn-start-versus").hidden = !vs.isHost;
    lobbyStatus("");
    $("topbar-status").textContent = "ルーム " + vs.code;
    $("lobby-hint").textContent = vs.isHost ? "友達にコードを伝えて、全員そろったら「対戦開始」。" : "ホストが開始するまでお待ちください。";
    renderTopicUI();
  }
  function leaveVersus() {
    stopTimer();
    try { vs.conn && vs.conn.close(); } catch {}
    try { vs.peer && vs.peer.destroy(); } catch {}
    vs.peer = null; vs.conn = null; vs.host = null; vs.pub = null; vs.isHost = false; vs.code = null; vs.me = -1;
    $("topbar-status").textContent = "";
  }
  function renderPlayers(ul, pub) {
    ul.innerHTML = "";
    pub.players.forEach((p, i) => {
      const li = el("li", (i === vs.me ? "me " : "") + (pub.status === "playing" && pub.turn === i ? "turn " : "") + (!p.connected || p.out ? "offline" : ""));
      const dot = el("span", "pdot"); dot.style.setProperty("--c", PLAYER_COLORS[i % PLAYER_COLORS.length]); li.appendChild(dot);
      li.appendChild(el("span", null, p.name + (i === 0 ? "（ホスト）" : "")));
      const setter = hasSetter(pub.mode) && i === pub.setter;
      const tag = !p.connected ? "切断" : p.out ? "降参" : setter ? (i === vs.me ? "出題者（あなた）" : "出題者") : i === vs.me ? "あなた" : "";
      if (tag) li.appendChild(el("span", "ptag", tag));
      ul.appendChild(li);
    });
  }

  // ロビーの「出題者」選択（ホストのみ操作可。お題・質問モード）
  function renderSetterUI(pub) {
    const on = vs.isHost && hasSetter(pub.mode) && pub.status === "lobby";
    $("setter-field").hidden = !on;
    if (!on) return;
    const sel = $("setter-select"); sel.innerHTML = "";
    pub.players.forEach((p, i) => { const o = el("option", null, p.name + (i === 0 ? "（ホスト）" : "")); o.value = String(i); sel.appendChild(o); });
    sel.value = String(pub.setter);
  }
  let renderedGuessCount = 0;
  let lastStatus = null;
  function applyState(pub) {
    vs.pub = pub;
    renderPlayers($("lobby-players"), pub);
    const topic = hasSetter(pub.mode);   // 出題者がいるモード（お題・質問）
    const qa = pub.mode === "qa";
    if (vs.isHost) $("btn-start-versus").disabled = pub.players.filter((p) => p.connected).length < 2 || (topic && !pub.topicChosen);
    if (pub.status === "lobby") {
      if (game.mode === "versus") { game.mode = null; stopTimer(); hideResult(); showScreen("lobby"); enterRoomView(); }
      if (!pub.topicChosen) vs.myTopic = -1;
      renderTopicUI();
      renderSetterUI(pub);
      const meSet = topic && vs.me === pub.setter;
      $("lobby-hint").textContent = vs.isHost
        ? (topic ? (meSet ? "お題を選んで、回答者がそろったら「対戦開始」。" : (pub.topicChosen ? `${setterName(pub)} がお題を決めました。「対戦開始」で始められます。` : `${setterName(pub)} がお題を選んでいます…`)) : "友達にコードを伝えて、全員そろったら「対戦開始」。")
        : (topic ? (meSet ? "あなたが出題者です。お題を選んでください（開始はホストが行います）。" : (pub.topicChosen ? "お題は決まりました。ホストが開始するまでお待ちください。" : `${setterName(pub)} がお題を選んでいます…`)) : "ホストが開始するまでお待ちください。");
      lastStatus = "lobby";
      return;
    }
    if (game.mode !== "versus" || lastStatus === "lobby" || lastStatus == null) {
      game.mode = "versus"; game.over = false;
      hideResult();
      showScreen("game");
      $("game-mode-label").textContent = qa ? "対戦モード（質問）" : topic ? "対戦モード（お題）" : "対戦モード（ランダム）";
      $("turn-box").hidden = false; $("game-players").hidden = false;
      $("game-log").innerHTML = "";
      clearBoard(); renderedGuessCount = -1;
      if (!timerHandle) timerHandle = setInterval(tick, 250);
      $("guess-input").placeholder = `${ITEM}名を入力`;
      $("qa-area").hidden = !qa; $("board-body").hidden = qa; $("board-empty").hidden = qa;
      $("guess-button").textContent = qa ? "回答" : "GUESS";
      $("qa-input").value = "";
    }
    if (renderedGuessCount > pub.guesses.length) { clearBoard(); renderedGuessCount = -1; } // 再戦
    if (renderedGuessCount < 0) { if (pub.hint >= 0 && pub.hintR) appendRow(renderGuessRow(pub.hint, pub.hintR, null, false)); renderedGuessCount = 0; }
    if (qa) { $("game-sub").textContent = `質問 残り ${pub.qLeft} / ${pub.opts.qMax}・回答 残り ${pub.gLeft} / ${pub.opts.gMax}`; setRemaining(null); }
    else {
      $("game-sub").textContent = `${difficultyLabel(pub.settings)}・ターン ${Math.min(pub.turnNo, pub.opts.maxTurns || pub.turnNo)}${pub.opts.maxTurns ? " / " + pub.opts.maxTurns : ""}`;
      setRemaining(pub.opts.maxTurns ? Math.max(0, pub.opts.maxTurns - pub.turnNo + 1) : null);
    }
    renderPlayers($("game-players"), pub);

    for (let i = renderedGuessCount; i < pub.guesses.length; i++) {
      const g = pub.guesses[i];
      appendRow(renderGuessRow(g.idx, g.r, { name: pub.players[g.p].name, color: PLAYER_COLORS[g.p % PLAYER_COLORS.length] }, true));
    }
    renderedGuessCount = pub.guesses.length;
    if (qa) renderQaLog(pub);

    const lg = $("game-log"); lg.innerHTML = "";
    pub.events.forEach((e) => lg.prepend(el("div", null, e)));

    vs.deadlineLocal = pub.deadline ? Date.now() + (pub.deadline - pub.now) : null;
    const meOut = pub.players[vs.me] && pub.players[vs.me].out;
    const meSetter = topic && vs.me === pub.setter;
    $("btn-surrender").hidden = pub.status !== "playing" || meOut || meSetter;

    if (pub.status === "playing") {
      if (lastStatus === "finished") { hideResult(); log("再戦スタート！"); }
      const mine = pub.turn === vs.me;
      const answering = qa && pub.phase === "answer";
      const who = $("turn-who");
      who.innerHTML = "";
      if (meSetter) {
        who.appendChild(document.createTextNode(answering ? "質問に答えてください" : `${pub.players[pub.turn].name} の番`));
        const tp = el("div", "turn-topic"); tp.append("お題：", el("b", null, myTopicIdx() >= 0 ? nameOf(C[myTopicIdx()]) : "")); who.appendChild(tp);
      } else who.textContent = answering ? `${setterName(pub)} が回答中…` : mine ? "あなたの番！" : `${pub.players[pub.turn].name} の番`;
      who.className = "turn-who" + ((mine && !answering) || (meSetter && answering) ? " me" : "");
      if (qa) {
        const canAct = mine && !meOut && !meSetter && !answering;
        $("qa-ask-panel").hidden = !(canAct && pub.qLeft > 0);
        $("qa-answer-panel").hidden = !(meSetter && answering);
        if (meSetter && answering) { const last = pub.qa[pub.qa.length - 1]; $("qa-pending-q").textContent = last && last.k === "q" ? `${pub.players[last.p].name}：${last.q}` : ""; }
        $("qa-ask-btn").disabled = !canAct;
        $("qa-input").disabled = !canAct;
        setInputEnabled(canAct && pub.gLeft > 0, meSetter ? "あなたは出題者です" : canAct ? (pub.gLeft > 0 ? `答えが分かったら${ITEM}名を入力（残り${pub.gLeft}回）` : "回答回数を使い切りました") : answering ? "出題者の回答を待っています…" : "相手の番です…");
        if (canAct && lastStatus !== "playing:" + pub.turnNo + ":" + pub.phase) (pub.qLeft > 0 ? $("qa-input") : $("guess-input")).focus();
        lastStatus = "playing:" + pub.turnNo + ":" + pub.phase;
      } else {
        setInputEnabled(mine && !meOut && !meSetter, meSetter ? "あなたは出題者です" : mine ? `${ITEM}名を入力して推理！` : "相手の番です…");
        if (mine && lastStatus !== "playing:" + pub.turnNo) $("guess-input").focus();
        lastStatus = "playing:" + pub.turnNo;
      }
      tick();
    } else if (pub.status === "finished") {
      setInputEnabled(false, "対戦終了");
      $("qa-ask-panel").hidden = true; $("qa-answer-panel").hidden = true;
      $("turn-who").textContent = "対戦終了"; $("turn-who").className = "turn-who"; $("turn-timer").textContent = "";
      if (lastStatus !== "finished") {
        const w = pub.winner;
        let verdict, cls;
        if (topic) {
          if (pub.reason === "correct") { verdict = meSetter ? `${pub.players[w].name} が正解！` : w === vs.me ? "正解！あなたの勝ち！" : `${pub.players[w].name} が正解`; cls = meSetter ? "lose" : w === vs.me ? "win" : "lose"; }
          else if (pub.reason === "max_turns") { verdict = meSetter ? "誰も当てられず！出題者の勝ち" : "ターン上限。誰も当てられず…"; cls = meSetter ? "win" : "lose"; }
          else if (pub.reason === "setter_left") { verdict = "出題者が退出したため終了"; cls = ""; }
          else if (pub.reason === "no_guesses") { verdict = meSetter ? "回答回数を使い切った！出題者の勝ち" : "回答回数を使い切って当てられず…"; cls = meSetter ? "win" : "lose"; }
          else { verdict = meSetter ? "全員降参！出題者の勝ち" : "全員降参…"; cls = meSetter ? "win" : "lose"; }
        }
        else if (pub.reason === "max_turns") { verdict = "ターン上限で引き分け"; cls = ""; }
        else if (pub.reason === "all_out") { verdict = "全員降参…"; cls = "lose"; }
        else if (w === vs.me) { verdict = pub.reason === "correct" ? "正解！あなたの勝ち！" : "他の全員が降参。あなたの勝ち！"; cls = "win"; }
        else { verdict = `${pub.players[w].name} の勝ち`; cls = "lose"; }
        showResult({ verdict, cls, answer: pub.answer, share: versusShareText(pub, verdict) });
      }
      lastStatus = "finished";
    }
  }
  // 質問モードの質疑ログ（時系列。最新が上）
  function renderQaLog(pub) {
    const ol = $("qa-log"); ol.innerHTML = "";
    let qn = 0;
    pub.qa.forEach((x) => {
      const isQ = x.k === "q"; if (isQ) qn++;
      const li = el("li", "qa-item" + (isQ ? "" : " guess"));
      const by = pub.players[x.p] ? pub.players[x.p].name : "?";
      const head = el("div", "qa-q");
      const dot = el("span", "pdot"); dot.style.setProperty("--c", PLAYER_COLORS[x.p % PLAYER_COLORS.length]); head.appendChild(dot);
      head.appendChild(el("span", "qa-no", isQ ? `Q${qn}` : "回答"));
      head.appendChild(el("span", "qa-by", by));
      head.appendChild(el("span", "qa-text", isQ ? x.q : nameOf(C[x.idx])));
      li.appendChild(head);
      if (isQ) li.appendChild(el("div", "qa-a " + (x.a || "pending"), x.a ? qaAnswerLabel(x.a) : "回答待ち…"));
      else li.appendChild(el("div", "qa-a " + (x.ok ? "yes" : "no"), x.ok ? "正解！" : "不正解"));
      ol.prepend(li);
    });
    $("qa-empty").hidden = pub.qa.length > 0;
  }
  function versusShareText(pub, verdict) {
    if (pub.mode === "qa") {
      return [`${CFG.title}｜対戦モード（質問）`, verdict, `正解：${nameOf(C[pub.answer])}`,
        `質問 ${pub.qa.filter((x) => x.k === "q").length} / ${pub.opts.qMax}・回答 ${pub.qa.filter((x) => x.k === "g").length} / ${pub.opts.gMax}`,
        ...pub.qa.map((x) => (x.k === "q" ? `Q: ${x.q} → ${qaAnswerLabel(x.a) || "-"}` : `A: ${nameOf(C[x.idx])} → ${x.ok ? "正解" : "不正解"}`))].join("\n");
    }
    return [`${CFG.title}｜対戦モード（${pub.mode === "topic" ? "お題" : "ランダム"}）`, verdict, `正解：${nameOf(C[pub.answer])}`, ...pub.guesses.map((g) => `${pub.players[g.p].name}: ${rowEmoji(g.r)}`)].join("\n");
  }
  function tick() {
    if (vs.isHost) hostTick();
    const pub = vs.pub;
    const t = $("turn-timer");
    if (!pub || pub.status !== "playing" || !vs.deadlineLocal) { t.textContent = pub && pub.status === "playing" ? "制限なし" : ""; t.className = "turn-timer"; return; }
    const left = vs.deadlineLocal - Date.now();
    t.textContent = fmtClock(left);
    t.className = "turn-timer" + (left < 10000 ? " low" : "");
  }
  function versusGuess(idx) {
    const pub = vs.pub; if (!pub || pub.status !== "playing" || pub.turn !== vs.me) { toast("あなたの番ではありません"); return; }
    if (vs.isHost) hostGuess(vs.me, idx);
    else if (vs.conn) vs.conn.send({ t: "guess", idx });
  }
  function versusSurrender() {
    if (vs.isHost) hostSurrender(vs.me);
    else if (vs.conn) vs.conn.send({ t: "surrender" });
  }

  // ---------------------------------------------------------------- events
  const keyedLink = (extra) => `${location.origin}${location.pathname}${extra || ""}${window.GAME_KEY ? "#k=" + window.GAME_KEY : ""}`;
  $("brand-btn").addEventListener("click", goHome);
  $("btn-solo").addEventListener("click", startSolo);
  $("btn-versus").addEventListener("click", () => openLobby());
  $("btn-create-room").addEventListener("click", createRoom);
  $("btn-join-room").addEventListener("click", joinRoom);
  $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("btn-copy-code").addEventListener("click", () => copyText(vs.code || ""));
  $("btn-copy-link").addEventListener("click", () => copyText(keyedLink(`?room=${vs.code}`)));
  $("btn-copy-app-link").addEventListener("click", () => copyText(keyedLink()));
  $("btn-start-versus").addEventListener("click", hostStart);
  $("btn-leave-lobby").addEventListener("click", () => { leaveVersus(); openLobby(); });
  // 2回押しで確定（ブラウザの confirm ダイアログは環境によって出ないため使わない）
  function armConfirm(btn, label, fn) {
    if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; clearTimeout(btn._t); fn(); return; }
    btn.dataset.armed = "1"; btn.dataset.orig = btn.textContent; btn.textContent = label;
    btn._t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; }, 3000);
  }
  $("btn-back-home").addEventListener("click", () => {
    if (game.mode === "versus" && vs.pub && vs.pub.status === "playing") armConfirm($("btn-back-home"), "本当に退出？（もう一度押す）", goHome);
    else goHome();
  });
  $("btn-surrender").addEventListener("click", () => {
    const btn = $("btn-surrender");
    if (game.mode === "solo") { if (game.guesses.length) armConfirm(btn, "本当に降参？（もう一度押す）", soloSurrender); else soloSurrender(); }
    else armConfirm(btn, "本当に降参？（もう一度押す）", versusSurrender);
  });
  $("guess-button").addEventListener("click", () => submitGuess());
  $("guess-input").addEventListener("input", () => { activeSuggest = -1; renderSuggest(); });
  $("guess-input").addEventListener("focus", renderSuggest);
  $("guess-input").addEventListener("blur", () => setTimeout(hideSuggest, 120));
  $("guess-input").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (suggestItems.length) { activeSuggest = (activeSuggest + 1) % suggestItems.length; renderSuggest(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (suggestItems.length) { activeSuggest = (activeSuggest - 1 + suggestItems.length) % suggestItems.length; renderSuggest(); } }
    else if (e.key === "Enter") { e.preventDefault(); submitGuess(); }
    else if (e.key === "Escape") hideSuggest();
  });
  $("btn-copy-result").addEventListener("click", () => lastResult && lastResult.share && copyText(lastResult.share));
  $("btn-result-home").addEventListener("click", goHome);
  $("btn-again").addEventListener("click", () => {
    hideResult();
    if (game.mode === "solo") startSolo();
    else if (game.mode === "versus" && vs.isHost) { if (vs.host && hasSetter(vs.host.mode)) hostBackToLobby(); else hostStart(); }
  });
  // 質問モード
  function versusAsk() {
    const q = $("qa-input").value.trim();
    if (!q) { toast("質問を入力してください"); return; }
    const pub = vs.pub; if (!pub || pub.status !== "playing" || pub.turn !== vs.me || pub.phase !== "ask") { toast("あなたの番ではありません"); return; }
    $("qa-input").value = "";
    if (vs.isHost) hostAsk(vs.me, q);
    else if (vs.conn) vs.conn.send({ t: "ask", q });
  }
  $("qa-ask-btn").addEventListener("click", versusAsk);
  $("qa-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); versusAsk(); } });
  QA_ANSWERS.forEach((a) => {
    const b = el("button", "btn qa-btn " + a.k, a.label); b.type = "button";
    b.addEventListener("click", () => { if (vs.isHost) hostAnswer(a.k); else if (vs.conn) vs.conn.send({ t: "answer", k: a.k }); });
    $("qa-answer-buttons").appendChild(b);
  });
  // ルーム作成カード：モードに応じて設定項目を出し分け
  function syncVsModeFields() {
    const m = selectedVsMode();
    $("qa-opts").hidden = m !== "qa";
    $("max-turns-field").hidden = m === "qa";
  }
  document.querySelectorAll('input[name="vsmode"]').forEach((r) => r.addEventListener("change", syncVsModeFields));
  syncVsModeFields();
  attachSuggest($("topic-input"), $("topic-suggest"), (i) => pickTopic(i));
  $("btn-topic-change").addEventListener("click", () => pickTopic(-1));
  // 出題者の交代（ホストのみ）
  $("setter-select").addEventListener("change", () => { if (vs.isHost) hostSetSetter(+$("setter-select").value); });
  $("btn-swap-setter").addEventListener("click", () => { hideResult(); if (vs.isHost && vs.host && hasSetter(vs.host.mode)) hostBackToLobby(true); });
  $("result-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) hideResult(); });
  window.addEventListener("beforeunload", () => { try { vs.peer && vs.peer.destroy(); } catch {} });

  // ------------------------------------------------------------------ init
  applyConfigText();
  buildSettingsUI();
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam && /^\d{6}$/.test(roomParam)) openLobby(roomParam);
};
