/* イナゲッサー — メインロジック
   - ひとりで遊ぶ: ローカル完結
   - 対戦モード : PeerJS (WebRTC) でホスト権威型。ホストが正解と進行を管理し、ゲストは推理を送るだけ。
*/
// loader.js が data.bin を復号したあとに INA_START(data) で起動する
window.INA_START = (D) => {
  "use strict";

  const C = D.chars;
  const $ = (id) => document.getElementById(id);
  const IMG_BASE = "https://dxi4wb638ujep.cloudfront.net/1/";
  const PEER_PREFIX = "inaguesser-";
  const PLAYER_COLORS = ["#e0a800", "#1e88e5", "#e53976", "#2e9e4f"];
  const MAX_PLAYERS = 4;

  // ---------------------------------------------------------------- utils
  const kanaNorm = (s) =>
    (s || "")
      .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\s・･ｰー\-‐]/g, "")
      .toLowerCase();

  // 検索用インデックス
  const SEARCH = C.map((c) => ({ n: kanaNorm(c.n), k: kanaNorm(c.k), a: kanaNorm(c.a) }));
  const NAME_TO_IDX = new Map(C.map((c, i) => [c.n, i]));

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  };
  const randInt = (n) => Math.floor(Math.random() * n);

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1800);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("コピーしました");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("コピーしました"); } catch { toast("コピーできませんでした"); }
      ta.remove();
    }
  }
  function log(msg) {
    const l = $("game-log");
    const line = el("div", null, msg);
    l.prepend(line);
    while (l.children.length > 30) l.lastChild.remove();
  }

  // ------------------------------------------------------------- settings
  const SETTINGS_KEY = "inaguesser.settings.v1";
  let settings = { difficulty: "main", works: D.works.map(() => true) };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved && Array.isArray(saved.works) && saved.works.length === D.works.length) settings = saved;
  } catch {}
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  }

  function poolIndices(s) {
    const out = [];
    for (let i = 0; i < C.length; i++) {
      const c = C[i];
      if (!s.works[c.f]) continue;
      if (s.difficulty === "main" && !c.m) continue;
      out.push(i);
    }
    return out;
  }

  function buildSettingsUI() {
    const grid = $("works-checks");
    grid.innerHTML = "";
    D.works.forEach((w, i) => {
      const lab = el("label");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!settings.works[i]; cb.dataset.i = i;
      cb.addEventListener("change", () => { settings.works[i] = cb.checked; saveSettings(); updatePoolCount(); });
      lab.appendChild(cb);
      lab.appendChild(el("span", null, w.replace("イナズマイレブン", "イナイレ")));
      grid.appendChild(lab);
    });
    document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
      r.checked = r.value === settings.difficulty;
      r.addEventListener("change", () => { if (r.checked) { settings.difficulty = r.value; saveSettings(); updatePoolCount(); } });
    });
    updatePoolCount();
  }
  function updatePoolCount() {
    const n = poolIndices(settings).length;
    $("pool-count").textContent = n ? `現在の出題候補：${n}人` : "出題候補が0人です。作品を1つ以上選んでください。";
  }

  // -------------------------------------------------------------- compare
  // 戻り値: {team:{s,same:Set}, gender:{s}, grade:{s,arrow}, element:{s}, first:{s,arrow}}
  function compare(gi, ai) {
    const g = C[gi], a = C[ai];
    const aset = new Set(a.t);
    const same = g.t.filter((t) => aset.has(t));
    const teamState = g.t.length === a.t.length && same.length === g.t.length ? "hit" : same.length ? "partial" : "miss";
    const gradeArrow = g.gr === a.gr ? null : g.go != null && a.go != null && g.go !== a.go ? (a.go > g.go ? "up" : "down") : null;
    return {
      team: { s: teamState, same: new Set(same) },
      gender: { s: g.g === a.g ? "hit" : "miss" },
      pos: { s: g.p === a.p ? "hit" : "miss" },
      grade: { s: g.gr === a.gr ? "hit" : "miss", arrow: gradeArrow },
      element: { s: g.e === a.e ? "hit" : "miss" },
      first: { s: g.f === a.f ? "hit" : "miss", arrow: g.f === a.f ? null : a.f > g.f ? "up" : "down" },
    };
  }
  const ARROW = { up: "▲", down: "▼" };
  const EMOJI = { hit: "🟩", partial: "🟨", miss: "⬜" };
  function rowEmoji(r) {
    const a = (x) => (x.s === "hit" ? "🟩" : x.arrow === "up" ? "⬆️" : x.arrow === "down" ? "⬇️" : "⬜");
    return EMOJI[r.team.s] + EMOJI[r.pos.s] + EMOJI[r.gender.s] + a(r.grade) + EMOJI[r.element.s] + a(r.first);
  }

  // ---------------------------------------------------------------- board
  function cell(state, text, arrow, extraCls) {
    const s = el("span", "cell " + state + (extraCls ? " " + extraCls : ""));
    s.appendChild(document.createTextNode(text));
    if (arrow) s.appendChild(el("span", "arrow", ARROW[arrow]));
    return s;
  }
  // 1推理 = 1カード（名前ヘッダー + 属性タイル）
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
    const img = el("img", "gcard-img"); img.alt = ""; img.loading = "lazy";
    if (c.i) { img.src = IMG_BASE + c.i + ".webp"; img.onerror = () => img.classList.add("none"); } else img.classList.add("none");
    head.appendChild(img);
    const nm = el("div", "gcard-name"); nm.appendChild(el("span", "nm", c.n)); nm.appendChild(el("span", "kn", c.k)); head.appendChild(nm);
    if (by) { const b = el("span", "gcard-by", by.name); b.style.setProperty("--c", by.color); head.appendChild(b); }
    card.appendChild(head);

    const tiles = el("div", "tiles");
    const teamContent = el("span");
    if (c.t.length) c.t.forEach((t) => teamContent.appendChild(el("span", "t" + (r.team.same.has(t) ? " same" : ""), t)));
    else teamContent.textContent = "所属なし";
    tiles.appendChild(tile("所属チーム", r.team.s, teamContent, null, true));
    tiles.appendChild(tile("ポジション", r.pos.s, c.p));
    tiles.appendChild(tile("性別", r.gender.s, c.g));
    tiles.appendChild(tile("学年", r.grade.s, c.gr, r.grade.arrow));
    tiles.appendChild(tile("属性", r.element.s, c.e));
    tiles.appendChild(tile("初登場", r.first.s, D.short[c.f], r.first.arrow));
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
  function searchChars(q) {
    const nq = kanaNorm(q);
    if (!nq) return [];
    const ex = excludedGuesses();
    const starts = [], contains = [];
    for (let i = 0; i < C.length; i++) {
      if (ex.has(i)) continue;
      const s = SEARCH[i];
      if (s.n.startsWith(nq) || s.k.startsWith(nq) || s.a.startsWith(nq)) starts.push(i);
      else if (s.n.includes(nq) || s.k.includes(nq) || s.a.includes(nq)) contains.push(i);
    }
    const byMain = (a, b) => (C[b].m - C[a].m) || (C[a].f - C[b].f);
    starts.sort(byMain); contains.sort(byMain);
    return starts.concat(contains).slice(0, 40);
  }
  function renderSuggest() {
    const ul = $("suggest");
    const q = $("guess-input").value;
    suggestItems = searchChars(q);
    ul.innerHTML = "";
    if (!q.trim()) { ul.hidden = true; return; }
    if (!suggestItems.length) {
      ul.appendChild(el("li", "s-empty", "該当するキャラがいません"));
    } else {
      suggestItems.forEach((i, k) => {
        const c = C[i];
        const li = el("li", k === activeSuggest ? "active" : "");
        li.dataset.i = i;
        li.appendChild(el("span", "s-name", c.n));
        li.appendChild(el("span", "s-kana", c.k));
        li.appendChild(el("span", "s-team", c.p + "・" + c.t.slice(0, 2).join(" / ")));
        li.addEventListener("mousedown", (e) => { e.preventDefault(); submitGuess(i); });
        ul.appendChild(li);
      });
    }
    ul.hidden = false;
  }
  function hideSuggest() { $("suggest").hidden = true; activeSuggest = -1; }
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
  const SOLO_MAX = 10;
  const game = { mode: null, answer: -1, hint: -1, guesses: [], over: false };
  // 本家と同じく、開始時に正解以外のキャラを1人ランダムに開示する
  function pickHint(pool, answer) {
    if (pool.length < 2) return -1;
    let h; do { h = pool[randInt(pool.length)]; } while (h === answer);
    return h;
  }
  function showHintRow(hintIdx, answerIdx) {
    if (hintIdx < 0) return;
    appendRow(renderGuessRow(hintIdx, compare(hintIdx, answerIdx), null, false));
  }
  function soloSub() { return `${game.guesses.length}手目`; }
  function setRemaining(n) { const p = $("remain-pill"); if (n == null) { p.hidden = true; return; } p.hidden = false; p.innerHTML = ""; p.appendChild(el("span", "rl", "残り")); p.appendChild(el("b", null, String(n))); p.appendChild(el("span", "rl", "回")); p.classList.toggle("low", n <= 3); }
  let timerHandle = null;

  function setInputEnabled(on, placeholder) {
    $("guess-input").disabled = !on;
    $("guess-button").disabled = !on;
    if (placeholder) $("guess-input").placeholder = placeholder;
  }

  function submitGuess(idx) {
    if (idx == null || idx < 0) {
      idx = resolveInputToIdx();
      if (idx < 0) { toast("候補からキャラを選んでください"); return; }
    }
    $("guess-input").value = "";
    hideSuggest();
    if (game.mode === "solo") soloGuess(idx);
    else if (game.mode === "versus") versusGuess(idx);
  }

  // ------------------------------------------------------------------ solo
  function startSolo() {
    const pool = poolIndices(settings);
    if (!pool.length) { toast("出題候補が0人です。設定を確認してください"); return; }
    game.mode = "solo"; game.answer = pool[randInt(pool.length)]; game.guesses = []; game.over = false;
    game.hint = pickHint(pool, game.answer);
    showScreen("game");
    $("game-mode-label").textContent = "ひとりで遊ぶ";
    $("game-sub").textContent = `${settings.difficulty === "main" ? "メインキャラ" : "全キャラ"}・候補 ${pool.length}人`;
    setRemaining(SOLO_MAX);
    $("turn-box").hidden = true; $("game-players").hidden = true;
    $("btn-surrender").hidden = false;
    $("game-log").innerHTML = "";
    clearBoard();
    showHintRow(game.hint, game.answer);
    setInputEnabled(true, "キャラ名を入力（ひらがな・ニックネームもOK）");
    $("guess-input").focus();
  }
  function soloGuess(idx) {
    if (game.over) return;
    if (game.guesses.some((g) => g.idx === idx)) { toast("すでに推理したキャラです"); return; }
    const r = compare(idx, game.answer);
    game.guesses.push({ idx, r });
    appendRow(renderGuessRow(idx, r, null, true));
    $("game-sub").textContent = soloSub();
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
    return [`イナゲッサー｜ひとりで遊ぶ`, `${head}（${settings.difficulty === "main" ? "メインキャラ" : "全キャラ"}）`, ...game.guesses.map((g) => rowEmoji(g.r))].join("\n");
  }

  // ---------------------------------------------------------------- result
  let lastResult = null;
  function showResult(res) {
    lastResult = res;
    const c = C[res.answer];
    const v = $("result-verdict"); v.textContent = res.verdict; v.className = "result-verdict " + (res.cls || "");
    const img = $("result-img"); img.className = ""; img.src = c.i ? IMG_BASE + c.i + ".webp" : ""; img.alt = c.n;
    img.onerror = () => { img.className = "none"; };
    $("result-title").textContent = c.n; $("result-kana").textContent = c.k;
    const dl = $("result-attrs"); dl.innerHTML = "";
    [["所属チーム", c.t.join(" / ") || "所属なし"], ["ポジション", c.p], ["性別", c.g], ["学年", c.gr], ["属性", c.e], ["初登場", D.works[c.f]]].forEach(([k, val]) => {
      dl.appendChild(el("dt", null, k)); dl.appendChild(el("dd", null, val));
    });
    $("btn-copy-result").hidden = !res.share;
    $("btn-again").textContent = game.mode === "versus" ? (vs.isHost ? "もう一度（同じメンバー）" : "ホストの再戦を待つ") : "もう一度";
    $("btn-again").disabled = game.mode === "versus" && !vs.isHost;
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
    stopTimer();
    hideResult();
    $("topbar-status").textContent = "";
    showScreen("home");
  }
  function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }

  // ---------------------------------------------------------------- versus
  const vs = {
    peer: null, isHost: false, code: null, conn: null, // guest: conn to host
    host: null,   // host-only authoritative state
    pub: null,    // public state (both sides)
    me: -1,       // my player index
    deadlineLocal: null,
    name: "",
  };
  const NICK_KEY = "inaguesser.nick";
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

  function makePeer(id) {
    // PeerJS の公開シグナリングサーバー + 既定の STUN/TURN を使用
    return new Peer(id, { debug: 1 });
  }

  // ---- host
  function createRoom() {
    if (!peerAvailable()) { toast("通信ライブラリが読み込めていません"); return; }
    const pool = poolIndices(settings);
    if (!pool.length) { toast("出題候補が0人です。ホームの設定を確認してください"); return; }
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
      vs.host = {
        players: [{ name, conn: null, connected: true, out: false }],
        status: "lobby",
        settings: { difficulty: settings.difficulty, works: settings.works.slice() },
        opts: { turnSec: +$("turn-seconds").value, maxTurns: +$("max-turns").value },
        answer: -1, guesses: [], turn: 0, turnNo: 1, deadline: null, winner: null, reason: null, events: [],
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
    else if (msg.t === "surrender") hostSurrender(pIdx);
  }
  function hostOnLeave(conn) {
    const H = vs.host; if (!H) return;
    const p = H.players.find((x) => x.conn === conn);
    if (!p || !p.connected) return;
    p.connected = false;
    hostEvent(`${p.name} が切断しました`);
    if (H.status === "lobby") {
      H.players = H.players.filter((x) => x.connected);
    } else if (H.status === "playing") {
      checkRemaining();
      if (H.status === "playing" && H.turn === H.players.indexOf(p)) advanceTurn(false);
    }
    hostBroadcast();
  }
  function hostEvent(text) { const H = vs.host; H.events.push(text); if (H.events.length > 20) H.events.shift(); }
  function activePlayers() { return vs.host.players.filter((p) => p.connected && !p.out); }

  function hostStart() {
    const H = vs.host;
    if (H.players.filter((p) => p.connected).length < 2) { toast("2人以上で開始できます"); return; }
    const pool = poolIndices(H.settings);
    if (!pool.length) { toast("出題候補が0人です"); return; }
    H.players = H.players.filter((p) => p.connected);
    H.players.forEach((p, i) => { p.out = false; if (p.conn) hostSend(p.conn, { t: "welcome", you: i }); });
    H.answer = pool[randInt(pool.length)];
    H.hint = pickHint(pool, H.answer);
    H.guesses = []; H.winner = null; H.reason = null; H.events = [];
    H.status = "playing";
    H.turn = randInt(H.players.length); H.turnNo = 1;
    H.deadline = H.opts.turnSec ? Date.now() + H.opts.turnSec * 1000 : null;
    hostEvent(`対戦開始！ 正解候補 ${pool.length}人`);
    hostBroadcast();
  }
  function hostGuess(pIdx, idx) {
    const H = vs.host;
    if (H.status !== "playing" || H.turn !== pIdx) return;
    if (!(idx >= 0 && idx < C.length)) return;
    if (H.guesses.some((g) => g.idx === idx)) { const p = H.players[pIdx]; if (p.conn) hostSend(p.conn, { t: "error", msg: "すでに推理されたキャラです" }); else toast("すでに推理されたキャラです"); return; }
    H.guesses.push({ p: pIdx, idx });
    if (idx === H.answer) { finish(pIdx, "correct"); }
    else advanceTurn(true);
    hostBroadcast();
  }
  function hostSurrender(pIdx) {
    const H = vs.host;
    if (H.status !== "playing") return;
    const p = H.players[pIdx]; if (!p || p.out) return;
    p.out = true; hostEvent(`${p.name} が降参しました`);
    checkRemaining();
    if (H.status === "playing" && H.turn === pIdx) advanceTurn(false);
    hostBroadcast();
  }
  function checkRemaining() {
    const H = vs.host;
    const act = activePlayers();
    if (act.length === 1) finish(H.players.indexOf(act[0]), "others_out");
    else if (act.length === 0) finish(null, "all_out");
  }
  function advanceTurn(countTurn) {
    const H = vs.host;
    if (countTurn) H.turnNo++;
    if (H.opts.maxTurns && H.turnNo > H.opts.maxTurns) { finish(null, "max_turns"); return; }
    const n = H.players.length;
    for (let k = 1; k <= n; k++) {
      const cand = (H.turn + k) % n;
      if (H.players[cand].connected && !H.players[cand].out) { H.turn = cand; break; }
    }
    H.deadline = H.opts.turnSec ? Date.now() + H.opts.turnSec * 1000 : null;
  }
  function finish(winner, reason) {
    const H = vs.host;
    H.status = "finished"; H.winner = winner; H.reason = reason; H.deadline = null;
  }
  function hostTick() {
    const H = vs.host;
    if (!H || H.status !== "playing" || !H.deadline) return;
    if (Date.now() >= H.deadline) {
      hostEvent(`${H.players[H.turn].name} は時間切れ`);
      advanceTurn(true);
      hostBroadcast();
    }
  }
  function publicState() {
    const H = vs.host;
    return {
      status: H.status,
      players: H.players.map((p) => ({ name: p.name, connected: p.connected, out: p.out })),
      settings: H.settings, opts: H.opts,
      guesses: H.guesses.map((g) => ({ p: g.p, idx: g.idx, r: compareSerial(g.idx, H.answer) })),
      turn: H.turn, turnNo: H.turnNo, now: Date.now(), deadline: H.deadline,
      winner: H.winner, reason: H.reason, events: H.events,
      answer: H.status === "finished" ? H.answer : -1,
      hint: H.hint, hintR: H.hint >= 0 ? compareSerial(H.hint, H.answer) : null,
    };
  }
  function compareSerial(gi, ai) { const r = compare(gi, ai); return { ...r, team: { s: r.team.s, same: [...r.team.same] } }; }
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
      const tag = !p.connected ? "切断" : p.out ? "降参" : i === vs.me ? "あなた" : "";
      if (tag) li.appendChild(el("span", "ptag", tag));
      ul.appendChild(li);
    });
  }

  let renderedGuessCount = 0;
  let lastStatus = null;
  function applyState(pub) {
    pub.guesses.forEach((g) => { if (!(g.r.team.same instanceof Set)) g.r.team.same = new Set(g.r.team.same); });
    if (pub.hintR && !(pub.hintR.team.same instanceof Set)) pub.hintR.team.same = new Set(pub.hintR.team.same);
    vs.pub = pub;
    // ロビー
    renderPlayers($("lobby-players"), pub);
    if (vs.isHost) $("btn-start-versus").disabled = pub.players.filter((p) => p.connected).length < 2;

    if (pub.status === "lobby") {
      if (game.mode === "versus") { game.mode = null; stopTimer(); hideResult(); showScreen("lobby"); enterRoomView(); }
      lastStatus = "lobby";
      return;
    }

    // ゲーム画面へ
    if (game.mode !== "versus" || lastStatus === "lobby" || lastStatus == null) {
      game.mode = "versus"; game.over = false;
      hideResult();
      showScreen("game");
      $("game-mode-label").textContent = "対戦モード";
      $("turn-box").hidden = false; $("game-players").hidden = false;
      $("game-log").innerHTML = "";
      clearBoard(); renderedGuessCount = -1;
      if (!timerHandle) timerHandle = setInterval(tick, 250);
      $("guess-input").placeholder = "キャラ名を入力";
    }
    if (renderedGuessCount > pub.guesses.length) { clearBoard(); renderedGuessCount = -1; } // 再戦
    if (renderedGuessCount < 0) { if (pub.hint >= 0 && pub.hintR) appendRow(renderGuessRow(pub.hint, pub.hintR, null, false)); renderedGuessCount = 0; }
    $("game-sub").textContent = `${pub.settings.difficulty === "main" ? "メインキャラ" : "全キャラ"}・ターン ${Math.min(pub.turnNo, pub.opts.maxTurns || pub.turnNo)}${pub.opts.maxTurns ? " / " + pub.opts.maxTurns : ""}`;
    setRemaining(pub.opts.maxTurns ? Math.max(0, pub.opts.maxTurns - pub.turnNo + 1) : null);
    renderPlayers($("game-players"), pub);

    for (let i = renderedGuessCount; i < pub.guesses.length; i++) {
      const g = pub.guesses[i];
      appendRow(renderGuessRow(g.idx, g.r, { name: pub.players[g.p].name, color: PLAYER_COLORS[g.p % PLAYER_COLORS.length] }, true));
    }
    renderedGuessCount = pub.guesses.length;

    // イベントログ（差分は簡易に全置換）
    const lg = $("game-log"); lg.innerHTML = "";
    pub.events.forEach((e) => lg.prepend(el("div", null, e)));

    vs.deadlineLocal = pub.deadline ? Date.now() + (pub.deadline - pub.now) : null;
    const meOut = pub.players[vs.me] && pub.players[vs.me].out;
    $("btn-surrender").hidden = pub.status !== "playing" || meOut;

    if (pub.status === "playing") {
      if (lastStatus === "finished") { hideResult(); log("再戦スタート！"); }
      const mine = pub.turn === vs.me;
      const who = $("turn-who");
      who.textContent = mine ? "あなたの番！" : `${pub.players[pub.turn].name} の番`;
      who.className = "turn-who" + (mine ? " me" : "");
      setInputEnabled(mine && !meOut, mine ? "キャラ名を入力して推理！" : "相手の番です…");
      if (mine && lastStatus !== "playing:" + pub.turnNo) { $("guess-input").focus(); }
      lastStatus = "playing:" + pub.turnNo;
      tick();
    } else if (pub.status === "finished") {
      setInputEnabled(false, "対戦終了");
      $("turn-who").textContent = "対戦終了"; $("turn-who").className = "turn-who"; $("turn-timer").textContent = "";
      if (lastStatus !== "finished") {
        const w = pub.winner;
        let verdict, cls;
        if (pub.reason === "max_turns") { verdict = "ターン上限で引き分け"; cls = ""; }
        else if (pub.reason === "all_out") { verdict = "全員降参…"; cls = "lose"; }
        else if (w === vs.me) { verdict = pub.reason === "correct" ? "正解！あなたの勝ち！" : "他の全員が降参。あなたの勝ち！"; cls = "win"; }
        else { verdict = `${pub.players[w].name} の勝ち`; cls = "lose"; }
        showResult({ verdict, cls, answer: pub.answer, share: versusShareText(pub, verdict) });
      }
      lastStatus = "finished";
    }
  }
  function versusShareText(pub, verdict) {
    return [`イナゲッサー｜対戦モード`, verdict, `正解：${C[pub.answer].n}`, ...pub.guesses.slice().map((g) => `${pub.players[g.p].name}: ${rowEmoji(g.r)}`)].join("\n");
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
    if (vs.isHost) hostSurrender(0);
    else if (vs.conn) vs.conn.send({ t: "surrender" });
  }

  // ---------------------------------------------------------------- events
  $("brand-btn").addEventListener("click", goHome);
  $("btn-solo").addEventListener("click", startSolo);
  $("btn-versus").addEventListener("click", () => openLobby());
  $("btn-create-room").addEventListener("click", createRoom);
  $("btn-join-room").addEventListener("click", joinRoom);
  $("join-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  $("btn-copy-code").addEventListener("click", () => copyText(vs.code || ""));
  $("btn-copy-link").addEventListener("click", () => copyText(`${location.origin}${location.pathname}?room=${vs.code}#k=${window.INA_KEY}`));
  $("btn-copy-app-link").addEventListener("click", () => copyText(`${location.origin}${location.pathname}#k=${window.INA_KEY}`));
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
    else if (game.mode === "versus" && vs.isHost) hostStart();
  });
  $("result-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) hideResult(); });
  window.addEventListener("beforeunload", () => { try { vs.peer && vs.peer.destroy(); } catch {} });

  // ------------------------------------------------------------------ init
  buildSettingsUI();
  const roomParam = new URLSearchParams(location.search).get("room");
  if (roomParam && /^\d{6}$/.test(roomParam)) openLobby(roomParam);
};
