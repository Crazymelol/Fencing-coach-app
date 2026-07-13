/* Fencing Coach — Touch Recorder
 *
 * Data model:
 * {
 *   bouts: [{
 *     id, left, right, target, startedAt, endedAt, winner, synced,
 *     touches: [{ x, scorer: "left"|"right", action: "attack"|"defence", t }]
 *   }]
 * }
 * x is the touch position in metres from the left end of the 14 m piste.
 *
 * Bouts live in a Supabase table ("bouts") shared by every device.
 * localStorage is an offline cache: bouts recorded without connectivity are
 * kept with synced=false and pushed the next time the cloud is reachable.
 */

const STORAGE_KEY = "fencing-coach-data";
const PISTE_LEN = 14;
// 2 m bins across the piste, labels relative to the athlete's own end
const ZONE_LABELS = ["Own warn", "Own back", "Own guard", "Centre", "Opp guard", "Opp back", "Opp warn"];

const $ = (id) => document.getElementById(id);

// ---------- storage ----------
function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (d && Array.isArray(d.bouts)) return d;
  } catch (e) { /* corrupted storage falls through to fresh state */ }
  return { bouts: [] };
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let data = loadData();

// ---------- cloud storage (Supabase) ----------
const SUPABASE_URL = "https://qrpwtuztfamukrcnkpwc.supabase.co";
const SUPABASE_KEY = "sb_publishable_K94YBKPiFbcq-zz9xrzJfA_idTVFYQt";
const BOUTS_API = SUPABASE_URL + "/rest/v1/bouts";
const API_HEADERS = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };

const boutToRow = (b) => ({
  id: b.id,
  left_name: b.left,
  right_name: b.right,
  target: b.target,
  context: b.context || "training",
  started_at: new Date(b.startedAt).toISOString(),
  ended_at: b.endedAt ? new Date(b.endedAt).toISOString() : null,
  winner: b.winner,
  touches: b.touches,
});
const rowToBout = (r) => ({
  id: r.id,
  left: r.left_name,
  right: r.right_name,
  target: r.target,
  context: r.context || "training",
  startedAt: Date.parse(r.started_at),
  endedAt: r.ended_at ? Date.parse(r.ended_at) : null,
  winner: r.winner,
  touches: r.touches || [],
  synced: true,
});

async function cloudFetchAll() {
  const res = await fetch(BOUTS_API + "?select=*&order=started_at.asc", { headers: API_HEADERS });
  if (!res.ok) throw new Error("cloud fetch failed: " + res.status);
  return (await res.json()).map(rowToBout);
}
async function cloudInsert(b) {
  const res = await fetch(BOUTS_API, {
    method: "POST",
    headers: { ...API_HEADERS, Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(boutToRow(b)),
  });
  if (!res.ok) throw new Error("cloud insert failed: " + res.status);
}
async function cloudDeleteAll() {
  const res = await fetch(BOUTS_API + "?id=like.*", { method: "DELETE", headers: API_HEADERS });
  if (!res.ok) throw new Error("cloud delete failed: " + res.status);
}

function setCloudStatus(state, msg) {
  document.querySelectorAll(".cloud-status").forEach((el) => {
    el.dataset.state = state;
    el.textContent = msg;
  });
}

let syncing = false;
async function syncWithCloud() {
  if (syncing) return;
  syncing = true;
  setCloudStatus("sync", "☁ Syncing…");
  try {
    for (const b of data.bouts.filter((x) => !x.synced)) {
      await cloudInsert(b);
      b.synced = true;
    }
    const cloud = await cloudFetchAll();
    const cloudIds = new Set(cloud.map((b) => b.id));
    const pending = data.bouts.filter((b) => !b.synced && !cloudIds.has(b.id));
    data.bouts = [...cloud, ...pending].sort((a, b) => a.startedAt - b.startedAt);
    saveData();
    setCloudStatus("ok", `☁ Online — ${data.bouts.length} bouts in club database`);
    if ($("screen-setup").classList.contains("active")) renderSetup();
    if ($("screen-stats").classList.contains("active")) renderStats();
  } catch (e) {
    const pending = data.bouts.filter((b) => !b.synced).length;
    setCloudStatus("err", "⚠ Offline — saving on this device" + (pending ? `, ${pending} bout(s) waiting to sync` : ""));
  } finally {
    syncing = false;
  }
}
window.addEventListener("online", syncWithCloud);

// ---------- app state ----------
let bout = null;          // current bout in progress
let pendingTouch = null;  // { x } waiting for scorer/action
let pendingScorer = null;
let pendingAction = null; // "attack" | "defence" waiting for its subtype

// ---------- navigation ----------
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + screen).classList.add("active");
  if (screen === "setup") renderSetup();
  if (screen === "stats") renderStats();
}
document.querySelectorAll("[data-nav]").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.nav))
);

// ---------- helpers ----------
function athleteNames() {
  const set = new Set();
  data.bouts.forEach((b) => { set.add(b.left); set.add(b.right); });
  return [...set].sort((a, b) => a.localeCompare(b));
}
function boutScore(b) {
  let l = 0, r = 0;
  b.touches.forEach((t) => (t.scorer === "left" ? l++ : r++));
  return { l, r };
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " " + new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
const ctxBadge = (b) => ((b.context || "training") === "competition" ? "🏆" : "🏋");

// specific action types offered after choosing attack / defence
const SUBTYPE_LABELS = {
  attack: {
    "beat-hit": "Attack + beat",
    "preparation": "On preparation",
    "open-distance": "Open-distance",
    "long": "Long attack",
  },
  defence: {
    "parry-riposte": "Parry-riposte",
    "counter-attack": "Counter-attack",
    "beat-hit": "Beat hit",
  },
};
function actionLabel(t) {
  const icon = t.action === "attack" ? "⚔️" : "🛡️";
  const sub = t.subtype && SUBTYPE_LABELS[t.action] && SUBTYPE_LABELS[t.action][t.subtype];
  return `${icon} ${sub || (t.action === "attack" ? "Attack" : "Defence")}`;
}

// ---------- setup screen ----------
let target = 5;
$("target-seg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  target = +btn.dataset.target;
  document.querySelectorAll("#target-seg .seg-btn").forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
});

let context = "training";
$("context-seg").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  context = btn.dataset.context;
  document.querySelectorAll("#context-seg .seg-btn").forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
});

function renderSetup() {
  const dl = $("athlete-list");
  dl.innerHTML = athleteNames().map((n) => `<option value="${n}">`).join("");

  const recent = data.bouts.slice(-5).reverse();
  $("recent-card").classList.toggle("hidden", recent.length === 0);
  $("recent-bouts").innerHTML = recent.map((b) => {
    const s = boutScore(b);
    return `<div class="bout-item" data-id="${b.id}">
      <span>${ctxBadge(b)} ${b.left} vs ${b.right}</span>
      <span class="res">${s.l} – ${s.r}</span>
      <span class="meta">${fmtDate(b.startedAt)}</span>
    </div>`;
  }).join("");
}

$("btn-start").addEventListener("click", () => {
  const left = $("name-left").value.trim();
  const right = $("name-right").value.trim();
  const valid = left && right && left.toLowerCase() !== right.toLowerCase();
  $("setup-error").classList.toggle("hidden", valid);
  if (!valid) return;
  startBout(left, right);
});

function startBout(left, right) {
  bout = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    left, right, target, context,
    startedAt: Date.now(),
    endedAt: null,
    winner: null,
    touches: [],
  };
  pendingTouch = null;
  renderBout();
  show("bout");
}

// ---------- bout screen ----------
function renderBout() {
  const s = boutScore(bout);
  $("sb-name-left").textContent = bout.left;
  $("sb-name-right").textContent = bout.right;
  $("sb-score-left").textContent = s.l;
  $("sb-score-right").textContent = s.r;
  $("sb-target").textContent = "to " + bout.target;
  $("sb-touchcount").textContent = "touch " + (bout.touches.length + 1);
  $("piste-label-left").textContent = bout.left.toUpperCase();
  $("piste-label-right").textContent = bout.right.toUpperCase();

  const wrap = $("touch-markers");
  wrap.innerHTML = "";
  bout.touches.forEach((t, i) => {
    const m = document.createElement("div");
    const last = i === bout.touches.length - 1;
    m.className = "marker " + t.action + (last ? "" : " faded");
    m.style.left = (t.x / PISTE_LEN) * 100 + "%";
    m.style.top = 35 + ((i * 37) % 31) + "%"; // spread markers vertically so stacks stay visible
    wrap.appendChild(m);
  });
}

$("piste").addEventListener("pointerdown", (e) => {
  if (pendingTouch) return;
  const rect = $("piste").getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  pendingTouch = { x: +(frac * PISTE_LEN).toFixed(2), yFrac: (e.clientY - rect.top) / rect.height };

  const m = document.createElement("div");
  m.className = "marker pending";
  m.id = "pending-marker";
  m.style.left = frac * 100 + "%";
  m.style.top = pendingTouch.yFrac * 100 + "%";
  $("touch-markers").appendChild(m);

  $("choice-left").textContent = "🔴 " + bout.left;
  $("choice-right").textContent = "🟢 " + bout.right;
  $("dlg-scorer").classList.remove("hidden");
});

function cancelPending() {
  pendingTouch = null;
  pendingScorer = null;
  pendingAction = null;
  const m = $("pending-marker");
  if (m) m.remove();
  $("dlg-scorer").classList.add("hidden");
  $("dlg-action").classList.add("hidden");
  $("dlg-subaction").classList.add("hidden");
}
$("cancel-touch").addEventListener("click", cancelPending);

$("choice-left").addEventListener("click", () => pickScorer("left"));
$("choice-right").addEventListener("click", () => pickScorer("right"));
function pickScorer(side) {
  pendingScorer = side;
  $("dlg-scorer").classList.add("hidden");
  $("action-title").textContent =
    (side === "left" ? bout.left : bout.right) + " — attack or defence?";
  $("dlg-action").classList.remove("hidden");
}
$("back-scorer").addEventListener("click", () => {
  $("dlg-action").classList.add("hidden");
  $("dlg-scorer").classList.remove("hidden");
});

$("choice-attack").addEventListener("click", () => pickAction("attack"));
$("choice-defence").addEventListener("click", () => pickAction("defence"));
function pickAction(action) {
  pendingAction = action;
  $("dlg-action").classList.add("hidden");
  $("subaction-title").textContent = (action === "attack" ? "Attack" : "Defence") + " — what type?";
  $("sub-attack").classList.toggle("hidden", action !== "attack");
  $("sub-defence").classList.toggle("hidden", action !== "defence");
  $("dlg-subaction").classList.remove("hidden");
}
$("back-action").addEventListener("click", () => {
  $("dlg-subaction").classList.add("hidden");
  $("dlg-action").classList.remove("hidden");
});
document.querySelectorAll("#dlg-subaction [data-sub]").forEach((btn) =>
  btn.addEventListener("click", () => recordTouch(pendingAction, btn.dataset.sub))
);

function recordTouch(action, subtype) {
  bout.touches.push({ x: pendingTouch.x, scorer: pendingScorer, action, subtype, t: Date.now() });
  cancelPending();
  renderBout();

  const s = boutScore(bout);
  if (s.l >= bout.target || s.r >= bout.target) endBout();
}

$("btn-undo").addEventListener("click", () => {
  if (pendingTouch) { cancelPending(); return; }
  bout.touches.pop();
  renderBout();
});

$("btn-end-bout").addEventListener("click", () => {
  if (bout.touches.length === 0) { show("setup"); return; }
  endBout();
});

function endBout() {
  cancelPending();
  const s = boutScore(bout);
  bout.endedAt = Date.now();
  bout.winner = s.l === s.r ? null : (s.l > s.r ? bout.left : bout.right);
  bout.synced = false;
  data.bouts.push(bout);
  saveData();
  syncWithCloud();

  $("boutend-summary").textContent =
    `${bout.left} ${s.l} – ${s.r} ${bout.right}\n` +
    (bout.winner ? `Winner: ${bout.winner}` : "Draw") +
    `\n${bout.touches.length} touches recorded ✓ saved`;
  $("dlg-boutend").classList.remove("hidden");
}

$("btn-next-bout").addEventListener("click", () => {
  $("dlg-boutend").classList.add("hidden");
  $("name-left").value = "";
  $("name-right").value = "";
  show("setup");
  $("name-left").focus();
});
$("btn-rematch").addEventListener("click", () => {
  $("dlg-boutend").classList.add("hidden");
  startBout(bout.right, bout.left); // swap sides as fencers change ends
});
$("btn-view-stats").addEventListener("click", () => {
  $("dlg-boutend").classList.add("hidden");
  show("stats");
});
$("btn-bout-breakdown").addEventListener("click", () => {
  if (bout) openBoutDetail(bout.id); // the finished bout is still referenced; detail stacks over this popup
});

// ---------- statistics ----------
let statsFilter = "all";
$("stats-filter").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  statsFilter = btn.dataset.filter;
  document.querySelectorAll("#stats-filter .seg-btn").forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
  renderAthleteStats();
});
const filteredBouts = () =>
  data.bouts.filter((b) => statsFilter === "all" || (b.context || "training") === statsFilter);

function athleteStats(name) {
  const st = {
    bouts: 0, wins: 0,
    scored: 0, received: 0,
    attack: 0, defence: 0,
    // marker lists, x normalised so the athlete's own end is always at 0
    markers: [],          // touches scored: {x, action}
    receivedMarkers: [],  // touches conceded: {x}
    zones: new Array(ZONE_LABELS.length).fill(0),
    subtypes: { attack: {}, defence: {} }, // scored touches by specific type
    clinchers: {},        // winning-touch type -> count (bouts this athlete won)
    avgX: 0,
  };
  let sumX = 0;
  filteredBouts().forEach((b) => {
    const side = b.left === name ? "left" : b.right === name ? "right" : null;
    if (!side) return;
    st.bouts++;
    if (b.winner === name) st.wins++;
    b.touches.forEach((t) => {
      // normalise: athlete defends the left end (x = 0)
      const x = side === "left" ? t.x : PISTE_LEN - t.x;
      if (t.scorer === side) {
        st.scored++;
        st[t.action]++;
        const key = t.subtype || "other";
        st.subtypes[t.action][key] = (st.subtypes[t.action][key] || 0) + 1;
        st.markers.push({ x, action: t.action });
        st.zones[Math.min(ZONE_LABELS.length - 1, Math.floor(x / 2))]++;
        sumX += x;
      } else {
        st.received++;
        st.receivedMarkers.push({ x });
      }
    });
    // the last touch reached target and ended the bout — if this athlete scored it, it's a clincher
    const last = b.touches[b.touches.length - 1];
    if (b.winner === name && last && last.scorer === side) {
      const label = subtypeLabelFor(last.action, last.subtype || "other");
      st.clinchers[label] = (st.clinchers[label] || 0) + 1; // keyed by display label (action-disambiguated)
    }
  });
  st.avgX = st.scored ? sumX / st.scored : 0;
  st.topClincher = topEntry(st.clinchers);
  return st;
}

// { key: count } -> { key, label, count } of the largest entry, or null
function topEntry(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  const [key, count] = entries.sort((a, b) => b[1] - a[1])[0];
  return { key, count };
}
// label for a subtype key within a known action group ("beat-hit" exists in both, so pass the action)
function subtypeLabelFor(action, key) {
  return (SUBTYPE_LABELS[action] && SUBTYPE_LABELS[action][key]) ||
    (key === "other" ? "Unspecified" : key);
}

function renderStats() {
  const names = athleteNames();
  const sel = $("stats-athlete");
  const prev = sel.value;
  sel.innerHTML = names.length
    ? names.map((n) => `<option ${n === prev ? "selected" : ""}>${n}</option>`).join("")
    : `<option disabled selected>— no data yet —</option>`;
  renderAthleteStats();
}
$("stats-athlete").addEventListener("change", renderAthleteStats);

function renderAthleteStats() {
  const name = $("stats-athlete").value;
  const grid = $("stat-grid");
  const markers = $("stats-markers");
  const zoneChart = $("zone-chart");
  const boutsList = $("stats-bouts");

  if (!name || !athleteNames().includes(name)) {
    $("stats-name").textContent = "";
    grid.innerHTML = `<p class="empty">Record a bout first — statistics will appear here.</p>`;
    markers.innerHTML = "";
    zoneChart.innerHTML = "";
    boutsList.innerHTML = "";
    $("type-clincher").textContent = "";
    $("type-attack").innerHTML = "";
    $("type-defence").innerHTML = "";
    return;
  }

  const st = athleteStats(name);
  $("stats-name").textContent = name;

  const pct = (n, d) => (d ? Math.round((n / d) * 100) + "%" : "—");
  grid.innerHTML = [
    [st.bouts, "Bouts"],
    [st.wins, "Wins"],
    [pct(st.wins, st.bouts), "Win rate"],
    [st.scored, "Touches scored"],
    [st.received, "Touches received"],
    [st.scored - st.received, "Indicator (+/−)"],
    [pct(st.attack, st.scored), `Attack (${st.attack})`],
    [pct(st.defence, st.scored), `Defence (${st.defence})`],
    [st.scored ? st.avgX.toFixed(1) + " m" : "—", "Avg. scoring position"],
  ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  // touch map
  markers.innerHTML = "";
  const place = (x, cls, i) => {
    const m = document.createElement("div");
    m.className = "marker " + cls;
    m.style.left = (x / PISTE_LEN) * 100 + "%";
    m.style.top = 20 + ((i * 23) % 61) + "%";
    markers.appendChild(m);
  };
  st.markers.forEach((t, i) => place(t.x, t.action, i));
  st.receivedMarkers.forEach((t, i) => place(t.x, "received", i + 3));

  // zone histogram
  const max = Math.max(1, ...st.zones);
  zoneChart.innerHTML = st.zones.map((c, i) =>
    `<div class="zone-bar">
      <div class="zv">${c || ""}</div>
      <div class="bar" style="height:${(c / max) * 80}%"></div>
      <div class="zl">${ZONE_LABELS[i]}</div>
    </div>`
  ).join("");

  // action-type breakdown + best closer
  $("type-clincher").textContent = st.topClincher
    ? `🏆 Best closer: ${st.topClincher.key} (${st.topClincher.count} winning touch${st.topClincher.count > 1 ? "es" : ""})`
    : "🏆 Best closer: — (no wins yet)";
  const renderTypeBars = (elId, action) => {
    const counts = st.subtypes[action];
    // fixed order from SUBTYPE_LABELS, plus any legacy "other"
    const keys = [...Object.keys(SUBTYPE_LABELS[action])];
    if (counts.other) keys.push("other");
    const groupMax = Math.max(1, ...keys.map((k) => counts[k] || 0));
    const anyScored = keys.some((k) => counts[k]);
    $(elId).innerHTML = anyScored
      ? keys.map((k) => {
          const c = counts[k] || 0;
          const top = c > 0 && c === groupMax;
          return `<div class="type-bar ${action}${top ? " top" : ""}">
            <span class="tl">${subtypeLabelFor(action, k)}</span>
            <span class="tbar"><span class="tfill" style="width:${(c / groupMax) * 100}%"></span></span>
            <span class="tc">${c}</span>
          </div>`;
        }).join("")
      : `<p class="empty">None yet.</p>`;
  };
  renderTypeBars("type-attack", "attack");
  renderTypeBars("type-defence", "defence");

  // bout history for this athlete (tap a bout for its own breakdown)
  const hist = filteredBouts().filter((b) => b.left === name || b.right === name).slice().reverse();
  boutsList.innerHTML = hist.map((b) => {
    const s = boutScore(b);
    const won = b.winner === name;
    const opp = b.left === name ? b.right : b.left;
    const own = b.left === name ? s.l : s.r;
    const oth = b.left === name ? s.r : s.l;
    return `<div class="bout-item" data-id="${b.id}">
      <span>${won ? "✅" : b.winner ? "❌" : "➖"} ${ctxBadge(b)} vs ${opp}</span>
      <span class="res">${own} – ${oth}</span>
      <span class="meta">${fmtDate(b.startedAt)}</span>
    </div>`;
  }).join("") || `<p class="empty">No bouts yet.</p>`;
}

// ---------- bout detail ----------
let bdBout = null;                                   // bout currently shown in the detail dialog
let bdFilter = { fencer: "all", action: "all" };     // marker/row filter

function openBoutDetail(id) {
  const b = data.bouts.find((x) => x.id === id);
  if (!b) return;
  bdBout = b;
  bdFilter = { fencer: "all", action: "all" };
  const s = boutScore(b);

  $("bd-title").textContent = `${b.left} ${s.l} – ${s.r} ${b.right}`;
  $("bd-meta").textContent =
    `${ctxBadge(b)} ${(b.context || "training") === "competition" ? "Competition" : "Training"}` +
    ` · to ${b.target} · ${fmtDate(b.startedAt)}` +
    (b.winner ? `\nWinner: ${b.winner}` : "");
  $("bd-label-left").textContent = b.left.toUpperCase();
  $("bd-label-right").textContent = b.right.toUpperCase();

  // fencer filter labels come from this bout
  $("bd-fencer-left").textContent = "🔴 " + b.left;
  $("bd-fencer-right").textContent = "🟢 " + b.right;
  // reset the filter segments to "All"
  document.querySelectorAll("#bd-filter-fencer .seg-btn").forEach((x) =>
    x.classList.toggle("active", x.dataset.fencer === "all"));
  document.querySelectorAll("#bd-filter-action .seg-btn").forEach((x) =>
    x.classList.toggle("active", x.dataset.action === "all"));

  const count = (side, action) => b.touches.filter((t) => t.scorer === side && t.action === action).length;
  $("bd-stats").innerHTML = [
    [count("left", "attack"), `${b.left} ⚔ attack`],
    [count("left", "defence"), `${b.left} 🛡 defence`],
    [count("right", "attack"), `${b.right} ⚔ attack`],
    [count("right", "defence"), `${b.right} 🛡 defence`],
  ].map(([v, l]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

  renderBdTouches();
  $("dlg-boutdetail").classList.remove("hidden");
}

// draw markers + touch rows for bdBout, honouring bdFilter (running score stays true across all touches)
function renderBdTouches() {
  const b = bdBout;
  if (!b) return;
  const passes = (t) =>
    (bdFilter.fencer === "all" || t.scorer === bdFilter.fencer) &&
    (bdFilter.action === "all" || t.action === bdFilter.action);

  const markers = $("bd-markers");
  markers.innerHTML = "";
  b.touches.forEach((t, i) => {
    if (!passes(t)) return;
    const m = document.createElement("div");
    m.className = `marker ${t.action} by-${t.scorer}`;
    m.dataset.i = i;
    m.style.left = (t.x / PISTE_LEN) * 100 + "%";
    m.style.top = 20 + ((i * 23) % 61) + "%";
    markers.appendChild(m);
  });

  let l = 0, r = 0;
  const rows = [];
  b.touches.forEach((t, i) => {
    t.scorer === "left" ? l++ : r++;            // running score counts every touch
    if (!passes(t)) return;
    const who = t.scorer === "left" ? `🔴 ${b.left}` : `🟢 ${b.right}`;
    rows.push(`<div class="touch-row" data-i="${i}">
      <span class="tn">${i + 1}</span>
      <span class="tw">${who}</span>
      <span class="ta">${actionLabel(t)}</span>
      <span class="tm">${(+t.x).toFixed(1)} m</span>
      <span class="res">${l}–${r}</span>
    </div>`);
  });
  $("bd-touches").innerHTML = rows.join("") ||
    `<p class="empty">No touches match this filter.</p>`;
}

// highlight a marker + its touch row together
function highlightTouch(i) {
  document.querySelectorAll("#bd-markers .marker.hi, #bd-touches .touch-row.hi")
    .forEach((el) => el.classList.remove("hi"));
  const m = $("bd-markers").querySelector(`.marker[data-i="${i}"]`);
  const row = $("bd-touches").querySelector(`.touch-row[data-i="${i}"]`);
  if (m) m.classList.add("hi");
  if (row) { row.classList.add("hi"); if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" }); }
}

$("bd-markers").addEventListener("click", (e) => {
  const m = e.target.closest(".marker");
  if (m) highlightTouch(+m.dataset.i);
});
$("bd-touches").addEventListener("click", (e) => {
  const row = e.target.closest(".touch-row");
  if (row) highlightTouch(+row.dataset.i);
});

$("bd-filter-fencer").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  bdFilter.fencer = btn.dataset.fencer;
  document.querySelectorAll("#bd-filter-fencer .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
  renderBdTouches();
});
$("bd-filter-action").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  bdFilter.action = btn.dataset.action;
  document.querySelectorAll("#bd-filter-action .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
  renderBdTouches();
});

$("bd-close").addEventListener("click", () => $("dlg-boutdetail").classList.add("hidden"));
["recent-bouts", "stats-bouts"].forEach((listId) =>
  $(listId).addEventListener("click", (e) => {
    const item = e.target.closest(".bout-item");
    if (item) openBoutDetail(item.dataset.id);
  })
);

// ---------- export / clear ----------
function download(filename, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
$("btn-export").addEventListener("click", () =>
  download("fencing-data.json", JSON.stringify(data, null, 2), "application/json")
);
$("btn-export-csv").addEventListener("click", () => {
  const rows = [["bout_id", "date", "context", "left", "right", "target", "touch_no", "position_m", "scorer", "action", "type"]];
  data.bouts.forEach((b) =>
    b.touches.forEach((t, i) =>
      rows.push([b.id, new Date(b.startedAt).toISOString(), b.context || "training", b.left, b.right, b.target,
        i + 1, t.x, t.scorer === "left" ? b.left : b.right, t.action, t.subtype || ""])
    )
  );
  download("fencing-data.csv", rows.map((r) => r.join(",")).join("\n"), "text/csv");
});
$("btn-clear").addEventListener("click", async () => {
  if (!confirm("Delete ALL recorded bouts and statistics for EVERY device? This cannot be undone.")) return;
  try {
    await cloudDeleteAll();
  } catch (e) {
    alert("Could not reach the online database — nothing was deleted. Try again when online.");
    return;
  }
  data = { bouts: [] };
  saveData();
  renderStats();
  setCloudStatus("ok", "☁ Online — 0 bouts in club database");
});

// ---------- init ----------
show("setup");
syncWithCloud();
