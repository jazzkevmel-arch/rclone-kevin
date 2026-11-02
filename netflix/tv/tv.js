// Netflix PLC for the TV: streaming only (no activities, notes or quizzes).
// Runs inside the Android TV app (repository folder tv-app/), which adds a native video player
// (window.Android), or in any TV browser, where it plays with <video> and ../sw.js.
// It reads and writes the same Drive files as the phone and PC app (../app.js), with the same merge rules,
// so a video left at minute 12 on the phone goes on at minute 12 on the TV, and back.
// Sign-in: the TV is paired once with the user's "llavero" (Apps Script, see llavero/Codigo.gs on the PC)
// by scanning a QR code with the phone. The web app URL below is not secret: without the key it gives nothing.
const LLAVERO_URL = "https://script.google.com/macros/s/AKfycbx-7bEIOzLJk61_ASIheRzdZLOZJO_IcDMMPFve-FoGjMXbCfkTHvrEhX3TP1O3S5MbXA/exec";
const PAIR_PAGE = "https://jazzkevmel-arch.github.io/rclone-kevin/netflix/tv/enlazar.html#";
const FILES_API = "https://www.googleapis.com/drive/v3/files/";
const BUNNY = "https://vz-8115f9c6-089.b-cdn.net/";
const NATIVE = !!(window.Android && window.Android.play);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toLocaleDateString("en-CA");
const K = v => v.p || v.id;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
};
const DEV = store.get("device") || (() => { const d = "tv" + Math.random().toString(36).slice(2, 8); store.set("device", d); return d; })();
const hue = c => { let h = 0; for (const ch of c.id + c.cat) h = (h * 31 + ch.charCodeAt(0)) % 997; return 160 + h % 130; };
const short = t => t.replace(/\s*\(.*?\)\s*/g, " ").trim();
const mins = s => Math.max(1, Math.round(s / 60)) + " min";

let C = [], CATS = [], S = { videos: {}, ultimo: null, uu: 0, md: {} }, ids = {}, IDX = new Map();
const V = v => S.videos[K(v)] || (S.videos[K(v)] = { pos: 0, dur: 0, visto: false, act: false, nota: "", u: 0 });
const sub = (o, k) => o[k] || (o[k] = {});
const touch = v => { V(v).u = Date.now(); };
// Only what plays on the TV: Drive videos (d) and Control Más+ lessons with their stream (b).
const playable = v => !!(v.d || v.b);
const all = () => [].concat(...C.map((c, ci) => c.videos.map((v, vi) => ({ c, ci, v, vi })))).filter(x => playable(x.v));
const pct = v => { const st = V(v); return st.visto ? 100 : st.dur ? Math.min(100, st.pos / st.dur * 100) : 0; };

// ---------- minutes and sync (same rules as ../app.js) ----------
function addMin(cat, m) {
  const d = today(), day = sub(sub(S.md, DEV), d);
  day[cat] = (day[cat] || 0) + m;
}
function totals() {
  const dias = {}, diasCat = {};
  for (const days of Object.values(S.md)) for (const [d, cats] of Object.entries(days)) for (const [c, m] of Object.entries(cats)) {
    dias[d] = (dias[d] || 0) + m;
    sub(diasCat, d)[c] = (diasCat[d][c] || 0) + m;
  }
  return { dias, diasCat };
}
function merge(r) {
  for (const [k, rv] of Object.entries(r.videos || {})) {
    const lv = S.videos[k];
    if (!lv) { S.videos[k] = rv; continue; }
    const [win, lose] = (rv.u || 0) > (lv.u || 0) ? [rv, lv] : [lv, rv];
    if (lose.visto && !win.visto) { win.visto = true; win.vf = lose.vf; }
    if (lose.visto && win.vf && lose.vf && lose.vf < win.vf) win.vf = lose.vf;
    S.videos[k] = win;
  }
  if ((r.uu || 0) > (S.uu || 0)) { S.ultimo = r.ultimo; S.uu = r.uu; }
  if (r.plan && (!S.plan || r.plan.fecha > S.plan.fecha)) S.plan = r.plan;
  else if (r.plan && S.plan && r.plan.fecha === S.plan.fecha) {
    S.plan.items = [...new Set([...r.plan.items, ...S.plan.items])];
    S.plan.u = Math.max(r.plan.u || 0, S.plan.u || 0);
  }
  for (const [dev, days] of Object.entries(r.md || {})) {
    if (dev !== DEV) { S.md[dev] = days; continue; }
    const mine = sub(S.md, DEV);
    for (const [d, cats] of Object.entries(days)) for (const [c, m] of Object.entries(cats)) {
      const day = sub(mine, d);
      day[c] = Math.max(day[c] || 0, m);
    }
  }
}
let saveT = null, busy = Promise.resolve(), dirty = false;
async function pull() {
  if (!ids.prog) { const f = await Drive.find(ids.folder, "progreso.json"); if (!f) return; ids.prog = f.id; }
  merge(JSON.parse((await Drive.read(ids.prog)) || "{}"));
}
const queue = fn => (busy = busy.then(fn, fn));
function save(ms = 15000) {
  dirty = true;
  if (saveT && ms >= 15000) return;
  clearTimeout(saveT);
  saveT = setTimeout(flush, ms);
}
function flush() {
  clearTimeout(saveT); saveT = null;
  if (!dirty) return busy;
  return queue(async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await pull();
      const body = JSON.stringify({ ...S, ...totals(), actualizado: new Date().toISOString() });
      ids.prog = (await Drive.write(ids.folder, "progreso.json", body, "application/json", ids.prog)).id;
      $("sync").textContent = "✔ Guardado";
    } catch (_) {
      dirty = true;
      $("sync").textContent = "Sin guardar: se reintenta";
      if (!saveT) saveT = setTimeout(flush, 30000);
    }
  });
}

// ---------- focus and remote control ----------
// Each screen is a list of "lines" ([data-line] elements). Up and down move between lines, left and right
// inside a line. Each line remembers its last position, like the rows of a streaming app.
let screen = "home", lines = [], li = 0, mem = {}, onFocus = null;
function scanLines() {
  const roots = [$("top"), $(screen), $("nextup")].filter(r => r && !r.hidden);
  if (!$("nextup").hidden) return [[...$("nextup").querySelectorAll(".f")]].map(x => ({ id: "next", els: x }));
  const out = [];
  for (const r of roots) for (const l of r.querySelectorAll("[data-line]")) {
    const els = [...l.querySelectorAll(".f")];
    if (els.length) out.push({ id: l.dataset.line, els });
  }
  return out;
}
function cur() { const l = lines[li]; return l && l.els[Math.min(mem[l.id] || 0, l.els.length - 1)]; }
function focusAt(lineIdx, idx) {
  lines = scanLines();
  if (!lines.length) return;
  li = Math.max(0, Math.min(lines.length - 1, lineIdx));
  const l = lines[li];
  if (idx !== undefined) mem[l.id] = Math.max(0, Math.min(l.els.length - 1, idx));
  document.querySelectorAll(".f.on").forEach(e => e.classList.remove("on"));
  const el = cur();
  if (!el) return;
  el.classList.add("on");
  place(el, l);
  onFocus && onFocus(el);
}
function focusLine(id, idx) {
  lines = scanLines();
  const i = lines.findIndex(l => l.id === id);
  focusAt(i < 0 ? 0 : i, idx);
}
// Keep the focused row at the top of the rows area and the focused tile at the left edge.
function place(el, l) {
  const trk = el.closest(".trk");
  if (trk) {
    const first = trk.firstElementChild, i = l.els.indexOf(el);
    const maxShift = Math.max(0, trk.scrollWidth - trk.parentElement.clientWidth);
    const x = Math.min(maxShift, Math.max(0, el.offsetLeft - first.offsetLeft - (i > 0 ? first.offsetWidth * 0.35 : 0)));
    trk.style.transform = `translateX(${-x}px)`;
  }
  const inner = el.closest(".rowsin, .epsin");
  if (inner) {
    const box = el.closest(".row") || el;
    const view = inner.parentElement.clientHeight;
    let y = box.offsetTop - (inner.classList.contains("epsin") ? view * 0.3 : 0);
    y = Math.max(0, Math.min(y, inner.scrollHeight - view * 0.6));
    inner.style.transform = `translateY(${-y}px)`;
  }
}
function move(dl, dx) {
  lines = scanLines();
  if (!lines.length) return;
  if (dl) return focusAt(li + dl);
  const l = lines[li], i = (mem[l.id] || 0) + dx;
  if (i < 0 || i >= l.els.length) return;
  focusAt(li, i);
}
function press() { const el = cur(); if (el) el.dispatchEvent(new CustomEvent("ok", { bubbles: true })); }

const KEYS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
document.addEventListener("keydown", e => {
  const isBack = ["Escape", "Backspace", "GoBack", "BrowserBack"].indexOf(e.key) >= 0;
  if (playing && !LEGACY && !$("pl").hidden && !isBack) return plKey(e);
  const k = KEYS[e.key];
  if (k) { e.preventDefault(); return move(k[0], k[1]); }
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return press(); }
  if (e.key === "Escape" || e.key === "Backspace" || e.key === "GoBack" || e.key === "BrowserBack") {
    e.preventDefault(); back();
  }
});
// Called by the Android app for the remote's Back button. Returns false when the app should close.
window.tvBack = () => back();
function back() {
  if (!$("pair").hidden || !$("load").hidden) return false;
  if (playing && !LEGACY && !$("pl").hidden) return plBack();
  if (!$("nextup").hidden) { hideNext(); return true; }
  if (screen === "course") { show(prevScreen); focusLine(prevLine.id, prevLine.idx); return true; }
  if (screen === "search" && kq) { kq = kq.slice(0, -1); renderSearch(); return true; }
  if (screen !== "home") { tab("home"); return true; }
  if (lines[li] && lines[li].id !== "tabs") { focusLine("tabs", 0); return true; }
  return false;
}

// ---------- screens ----------
let prevScreen = "home", prevLine = { id: "tabs", idx: 0 }, homeMode = "home";
function show(s) {
  stopPreview();
  for (const id of ["home", "course", "search"]) $(id).hidden = id !== s;
  $("top").hidden = s === "course";
  screen = s;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("sel", t.dataset.tab === (s === "home" ? homeMode : s)));
}
function tab(t) {
  if (t === "search") { show("search"); renderSearch(); return focusLine("k0", 0); }
  homeMode = t; mem = { tabs: mem.tabs };
  show("home"); renderHome();
  lines = scanLines();
  const first = document.querySelector("#rowsin .f");
  if (first) heroFor(first);
  focusLine(lines.length > 1 ? lines[1].id : "tabs", 0);
}
function tileHtml(x, cls = "") {
  const st = V(x.v), p = pct(x.v);
  return `<div class="t f ${cls}" data-v="${esc(K(x.v))}"><div class="a" style="--h:${hue(x.c)}">
    <span class="ct">${esc(short(x.c.title))}</span><span class="ep">${x.v.n}</span><span class="tt">${esc(x.v.t)}</span>
    ${st.visto ? '<span class="ok">✔ VISTO</span>' : ""}${p > 1 && p < 100 ? `<div class="pb"><i style="width:${p}%"></i></div>` : ""}</div></div>`;
}
function courseHtml(c, ci) {
  const vids = c.videos.filter(playable), seen = vids.filter(v => V(v).visto).length;
  return `<div class="t f course" data-c="${ci}"><div class="a" style="--h:${hue(c)}">
    <span class="ct">${esc(c.cat)}</span><span class="tt">${esc(short(c.title))}</span>
    <span class="n">${vids.length} episodios${seen ? ` · ${Math.round(seen / vids.length * 100)} % visto` : ""}</span>
    ${seen ? `<div class="pb"><i style="width:${seen / vids.length * 100}%"></i></div>` : ""}</div></div>`;
}
const rowHtml = (id, title, inner) => inner ? `<div class="row"><h3>${esc(title)}</h3><div style="overflow:hidden"><div class="trk" data-line="${id}">${inner}</div></div></div>` : "";
// Videos started and not finished, newest first.
function continuing() {
  return all().filter(x => { const st = V(x.v); return !st.visto && st.pos > 20; })
    .sort((a, b) => (V(b.v).u || 0) - (V(a.v).u || 0)).slice(0, 20);
}
function nextOf(c, ci) {
  const vi = c.videos.findIndex(v => playable(v) && !V(v).visto);
  return vi < 0 ? null : { c, ci, v: c.videos[vi], vi };
}
function renderHome() {
  let h = "";
  renderStats();
  if (homeMode === "home") {
    const plan = planHoy().items.map(k => IDX.get(k)).filter(Boolean);
    const done = plan.filter(x => V(x.v).visto).length;
    h += rowHtml("plan", `Tu plan de hoy · ${done} de ${planHoy().items.length} vistos`, plan.map(x => tileHtml(x)).join(""));
    h += rowHtml("cont", "Continuar viendo", continuing().map(x => tileHtml(x)).join(""));
    const nx = C.map((c, ci) => c.ruta ? nextOf(c, ci) : null).filter(Boolean);
    h += rowHtml("nx", "Siguiente en tu ruta", nx.map(x => tileHtml(x)).join(""));
    const seen = all().filter(x => V(x.v).visto).sort((a, b) => (V(b.v).u || 0) - (V(a.v).u || 0)).slice(0, 20);
    h += rowHtml("seen", "Vistos recientemente", seen.map(x => tileHtml(x)).join(""));
    for (const cat of CATS) {
      const cs = C.map((c, ci) => [c, ci]).filter(([c]) => c.cat === cat && c.videos.some(playable));
      h += rowHtml("cat" + CATS.indexOf(cat), cat, cs.map(([c, ci]) => courseHtml(c, ci)).join(""));
    }
  } else {
    // Mi ruta: one row per course, its episodes starting at the next one to watch.
    C.forEach((c, ci) => {
      if (!c.ruta) return;
      const xs = c.videos.map((v, vi) => ({ c, ci, v, vi })).filter(x => playable(x.v));
      if (!xs.length) return;
      const start = Math.max(0, xs.findIndex(x => !V(x.v).visto));
      h += rowHtml("r" + ci, short(c.title), xs.slice(start, start + 30).map(x => tileHtml(x)).join(""));
    });
  }
  $("rowsin").innerHTML = h || `<div class="row"><h3>No hay videos para mostrar.</h3></div>`;
  $("rowsin").style.transform = "";
  setTimeout(loadVisiblePics, 50);
}
function heroFor(el) {
  let c, title, sub, meta = "";
  if (el.dataset.v) {
    const x = IDX.get(el.dataset.v); if (!x) return;
    const st = V(x.v), p = pct(x.v);
    c = x.c; title = x.v.t; sub = `${short(c.title)} · Episodio ${x.v.n}${x.v.s ? " · " + x.v.s : ""}`;
    if (st.visto) meta = `<span class="hok">✔ Visto</span>`;
    else if (p > 1) meta = `<span class="hbar"><i style="width:${p}%"></i></span><span>Te quedan ${mins(st.dur - st.pos)}</span>`;
    else if (st.dur) meta = `<span>${mins(st.dur)}</span>`;
  } else if (el.dataset.c) {
    c = C[+el.dataset.c];
    const vids = c.videos.filter(playable), seen = vids.filter(v => V(v).visto).length, nx = nextOf(c, +el.dataset.c);
    title = short(c.title); sub = nx ? `Sigue: episodio ${nx.v.n}. ${nx.v.t}` : "Curso terminado";
    meta = `<span>${vids.length} episodios</span>` + (seen ? `<span class="hbar"><i style="width:${seen / vids.length * 100}%"></i></span><span>${seen} vistos</span>` : "");
  } else return;
  $("hero").style.setProperty("--h", hue(c));
  $("hcat").textContent = c.cat; $("htitle").textContent = title; $("hsub").textContent = sub; $("hmeta").innerHTML = meta;
}
onFocus = el => {
  const trk = el.closest(".trk");
  if (trk) { loadPics(trk); const nx = trk.closest(".row") && trk.closest(".row").nextElementSibling; if (nx) loadPics(nx.querySelector(".trk")); }
  if (screen === "home") { heroFor(el); if (el.dataset.v || el.dataset.c !== undefined) heroPicture(el); else stopPreview(); }
};

let courseIdx = null;
function openCourse(ci) {
  const l = lines[li]; prevScreen = screen; prevLine = { id: l ? l.id : "tabs", idx: l ? mem[l.id] || 0 : 0 };
  courseIdx = ci; renderCourse(); show("course");
  const c = C[ci], nx = nextOf(c, ci);
  mem.ep = nx ? c.videos.filter(playable).indexOf(nx.v) : 0;
  focusLine("cbtn", 0);
}
function renderCourse() {
  const c = C[courseIdx], ci = courseIdx, vids = c.videos.filter(playable), seen = vids.filter(v => V(v).visto).length, nx = nextOf(c, ci);
  $("cbg").style.setProperty("--h", hue(c));
  $("ccat").textContent = c.cat; $("ctitle").textContent = short(c.title);
  $("cmeta").innerHTML = `<span>${vids.length} episodios</span>` + (seen ? `<span class="hbar"><i style="width:${seen / vids.length * 100}%"></i></span><span>${seen} vistos</span>` : "");
  const st = nx && V(nx.v);
  $("cbtns").innerHTML = (nx ? `<div class="btn f" data-play="${esc(K(nx.v))}">▶ ${st.pos > 20 ? "Continuar" : "Ver"} episodio ${nx.v.n}</div>` : "") +
    `<div class="btn f" data-play="${esc(K(vids[0]))}" data-zero="1">Desde el inicio</div>`;
  let h = "", sec = null;
  for (const v of vids) {
    if ((v.s || "") !== sec) { sec = v.s || ""; if (sec) h += `<div class="sec">${esc(sec)}</div>`; }
    const s = V(v), p = pct(v);
    h += `<div class="e f" data-v="${esc(K(v))}"><span class="num">${v.n}</span><span class="et">${esc(v.t)}</span>
      ${s.visto ? '<span class="ed">✔ Visto</span>' : p > 1 ? `<span class="eb"><i style="width:${p}%"></i></span>` : s.dur ? `<span class="ed">${mins(s.dur)}</span>` : ""}</div>`;
  }
  $("epsin").innerHTML = `<div data-line="ep">${h}</div>`;
  $("epsin").style.transform = "";
}
// The episode list is one vertical list: up and down move inside it.
const _move = move;
move = (dl, dx) => {
  lines = scanLines();
  const l = lines[li];
  if (screen === "course" && l && l.id === "ep" && dl) {
    const i = (mem.ep || 0) + dl;
    if (i < 0) return focusLine("cbtn", 0);
    if (i < l.els.length) return focusAt(li, i);
    return;
  }
  if (screen === "course" && l && l.id === "cbtn" && dl > 0) return focusLine("ep", mem.ep || 0);
  if (screen === "course" && l && l.id === "ep" && dx) return;
  return _move(dl, dx);
};

// ---------- search with an on-screen keyboard ----------
let kq = "";
const ROWS = ["abcdefghi", "jklmnñopq", "rstuvwxyz", "0123456789"];
function renderSearch() {
  $("kq").textContent = kq;
  if (!$("keys").innerHTML) {
    $("keys").innerHTML = ROWS.map((r, i) => `<div class="kr" data-line="k${i}">${[...r].map(ch => `<div class="k f" data-k="${ch}">${ch}</div>`).join("")}</div>`).join("") +
      `<div class="kr" data-line="k4"><div class="k w f" data-k=" ">Espacio</div><div class="k w f" data-k="del">⌫ Borrar</div><div class="k w f" data-k="clr">Limpiar</div></div>`;
  }
  const s = kq.trim().toLowerCase();
  let h = "";
  if (s.length >= 2) {
    const cs = C.map((c, ci) => [c, ci]).filter(([c]) => c.videos.some(playable) && (c.title + " " + c.cat).toLowerCase().includes(s)).slice(0, 12);
    h += rowHtml("rc", "Cursos", cs.map(([c, ci]) => courseHtml(c, ci)).join(""));
    const vs = all().filter(x => (x.v.t + " " + (x.v.s || "")).toLowerCase().includes(s)).slice(0, 40);
    for (let i = 0; i < vs.length; i += 10) h += rowHtml("rv" + i, i ? "" : `Episodios (${vs.length === 40 ? "40+" : vs.length})`, vs.slice(i, i + 10).map(x => tileHtml(x)).join(""));
    if (!h) h = `<div class="row"><h3>Nada con «${esc(kq)}»</h3></div>`;
  } else h = `<div class="row"><h3>Busca un curso o un tema: por ejemplo «temporizador», «variador» o «pantalla».</h3></div>`;
  $("resin").innerHTML = h; $("resin").style.transform = "";
}

// ---------- OK button ----------
document.addEventListener("ok", e => {
  const t = e.target;
  if (t.dataset.tab) return tab(t.dataset.tab);
  if (t.dataset.k !== undefined) {
    const k = t.dataset.k;
    kq = k === "del" ? kq.slice(0, -1) : k === "clr" ? "" : (kq + k).slice(0, 30);
    const keep = { id: lines[li].id, idx: mem[lines[li].id] };
    renderSearch(); return focusLine(keep.id, keep.idx);
  }
  if (t.dataset.c !== undefined) return openCourse(+t.dataset.c);
  if (t.dataset.next) return t.dataset.next === "go" ? playNext() : hideNext();
  const key = t.dataset.play || t.dataset.v;
  if (key) { const x = IDX.get(key); if (x) play(x, !!t.dataset.zero); }
});
document.addEventListener("click", e => {   // mouse or touch (TV browsers with a pointer)
  const f = e.target.closest(".f"); if (!f) return;
  document.querySelectorAll(".f.on").forEach(x => x.classList.remove("on"));
  f.classList.add("on"); f.dispatchEvent(new CustomEvent("ok", { bubbles: true }));
});

// ---------- playback ----------
// Three ways to play:
//  - App 1.3 or newer (Android.cmd exists): native video under this page; this page draws the controls,
//    the frames while seeking and the subtitles, so they change without reinstalling the app.
//  - App 1.2 (only Android.play): the app's own player (kept until the app updates itself).
//  - TV browser without the app: <video> through ../sw.js, with the same controls as the app.
const LEGACY = NATIVE && !window.Android.cmd;
let playing = null, lastTick = null, nextX = null, nextT = null, nextBack = null;
let P = { pos: 0, dur: 0, on: false, buf: true }, scrub = null, uiT = null, plFocus = "pbtn", plBtn = 0;
let cues = [], lastCue, menu = null;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3];
const SIZES = [["Pequeño", 1.4], ["Mediano", 1.9], ["Grande", 2.5]];
const COLORS = [["Blanco", "#ffffff"], ["Amarillo", "#ffe14d"], ["Celeste", "#7fe3ff"], ["Verde", "#7dffa8"]];
const BGS = [["Sin fondo", "transparent", "0 0 .2em #000, 0 0 .45em #000, 0 0 .8em #000"], ["Sombra", "#00000088", "none"], ["Caja negra", "#000000", "none"]];
let speed = +store.get("tvspeed") || 1;
let subset = { on: true, size: 1, color: 0, bg: 1 };
try { subset = Object.assign(subset, JSON.parse(store.get("tvsubs") || "{}")); } catch (_) { /* defaults */ }
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srcOf = v => v.b ? BUNNY + v.b + "/playlist.m3u8" : FILES_API + v.d + "?alt=media&supportsAllDrives=true";

async function subFile(c, v) {
  try {
    if (ids.subs === undefined) ids.subs = (await Drive.find(ids.folder, "subtitulos", true)) || null;
    if (!ids.subs) return null;
    const d = await Drive.find(ids.subs.id, c.id, true);
    return d ? await Drive.find(d.id, String(v.n).padStart(2, "0") + ".vtt") : null;
  } catch (_) { return null; }
}
async function play(x, fromZero) {
  hideNext(); stopPreview();
  toast("Abriendo...");
  await Promise.race([queue(pull).catch(() => {}), sleep(3000)]);
  const st = V(x.v);
  const start = !fromZero && st.pos > 5 && (!st.dur || st.pos < st.dur - 15) ? st.pos : 0;
  S.ultimo = K(x.v); S.uu = Date.now(); save(1500);
  playing = x; lastTick = null;
  if (!Drive.valid()) await Drive.fromLlavero();
  if (LEGACY) {
    const f = await Promise.race([subFile(x.c, x.v), sleep(2500).then(() => null)]);
    toast("");
    Android.play(JSON.stringify({ url: srcOf(x.v), hls: !!x.v.b, token: Drive.token || "", start: Math.floor(start * 1000),
      title: `${short(x.c.title)} · ${x.v.n}. ${x.v.t}`, sub: f ? FILES_API + f.id + "?alt=media" : "" }));
    return;
  }
  toast("");
  P = { pos: start, dur: st.dur || 0, on: false, buf: true };
  scrub = null; menu = null; cues = []; lastCue = undefined;
  $("ptitle").innerHTML = `${esc(x.v.n + ". " + x.v.t)}<small>${esc(short(x.c.title))}</small>`;
  $("pmenu").hidden = true; $("pthumb").hidden = true; $("psub").hidden = true;
  document.documentElement.classList.add("playing");
  $("pl").hidden = false;
  if (NATIVE) Android.play(JSON.stringify({ url: srcOf(x.v), hls: !!x.v.b, token: Drive.token || "", start, speed }));
  else webStart(x, start);
  loadSubs(x);
  showUi("pbtn", 0);
  paint();
}
function cmd(op, v) {
  if (NATIVE) return Android.cmd(op, v || 0);
  const vid = $("video");
  if (op === "toggle") vid.paused ? vid.play() : vid.pause();
  else if (op === "seek") vid.currentTime = v;
  else if (op === "speed") vid.playbackRate = v;
  else if (op === "stop") { vid.pause(); vid.removeAttribute("src"); vid.load(); $("wp").hidden = true; }
}
function closePl(ended) {
  if (!playing || LEGACY) return;
  cmd("stop");
  clearTimeout(uiT); scrub = null; menu = null;
  document.documentElement.classList.remove("playing");
  $("pl").hidden = true; $("pl").classList.remove("ui");
  const x = playing;
  progress(P.pos, P.dur, false);
  playing = null; lastTick = null;
  if (ended) { const st = V(x.v); if (!st.visto) { st.visto = true; st.vf = today(); touch(x.v); } }
  save(800);
  refresh();
  if (ended) offerNext(x);
}
// Saves the position, the minutes of the day and "watched" at 90 %.
function progress(pos, dur, on) {
  if (!playing) return;
  const { c, v } = playing, st = V(v), now = Date.now();
  if (on && lastTick) addMin(c.cat, Math.min(5, (now - lastTick) / 60000));
  lastTick = on ? now : null;
  if (dur > 0) st.dur = dur;
  if (Math.abs((st.pos || 0) - pos) < 0.5) return;
  st.pos = pos; touch(v);
  if (st.dur && pos / st.dur >= 0.9 && !st.visto) { st.visto = true; st.vf = today(); save(1500); }
  else save();
}
// From the app, 4 times a second (or from <video> in a browser).
window.tvState = (pos, dur, on, buf) => {
  if (!playing || LEGACY) return;
  const wasOn = P.on;
  P.pos = pos; P.dur = dur || P.dur; P.on = on; P.buf = buf;
  progress(pos, dur, on);
  if (wasOn && !on) showUi(plFocus);
  paint();
};
window.tvEnded = () => closePl(true);
window.tvError = msg => {
  toast("No se pudo reproducir: " + msg, 6000);
  if (!playing) return;
  if (LEGACY) return window.tvClosed(V(playing.v).pos, V(playing.v).dur, false);
  closePl(false);
};
// App 1.2 only.
window.tvProgress = (pos, dur, on) => progress(pos, dur, on);
window.tvClosed = (pos, dur, ended) => {
  if (!playing) return;
  progress(pos, dur, false);
  const x = playing; playing = null; lastTick = null;
  if (ended) { const st = V(x.v); if (!st.visto) { st.visto = true; st.vf = today(); touch(x.v); } }
  save(800); refresh();
  if (ended) offerNext(x);
};

// ---------- player screen ----------
function paint() {
  const t = scrub ? scrub.t : P.pos, d = P.dur || 0, pc = d ? Math.min(100, t / d * 100) : 0;
  $("pfill").style.width = pc + "%"; $("pknob").style.left = pc + "%";
  $("ptime").textContent = fmt(t);
  $("pleft").textContent = d ? "-" + fmt(d - t) + (speed !== 1 ? `  ·  ${speed}x` : "") : "";
  $("bplay").textContent = P.on ? "❚❚ Pausa" : "▶ Reproducir";
  $("bspeed").textContent = "Velocidad " + speed + "x";
  $("pspin").hidden = !(P.buf && !scrub);
  if (scrub) {
    $("pthumb").hidden = false;
    $("pthumb").style.left = Math.min(92, Math.max(8, pc)) + "%";
    $("pthumbt").textContent = fmt(t);
  } else $("pthumb").hidden = true;
  showCue();
}
function showUi(focus, idx) {
  if (!playing) return;
  $("pl").classList.add("ui");
  plFocus = focus;
  if (idx !== undefined) plBtn = idx;
  const btns = [...document.querySelectorAll(".pb2")];
  btns.forEach((b, i) => b.classList.toggle("on", focus === "pbtn" && !menu && i === plBtn));
  $("pbar").classList.toggle("on", focus === "pbar");
  clearTimeout(uiT);
  uiT = setTimeout(() => { if (!menu && !scrub && P.on) $("pl").classList.remove("ui"); }, 5000);
}
function flash(t) { $("pbig").textContent = t; $("pbig").classList.add("on"); clearTimeout(flash.t); flash.t = setTimeout(() => $("pbig").classList.remove("on"), 700); }
function toggle() { cmd("toggle"); flash(P.on ? "❚❚" : "▶"); showUi(plFocus); }

// Left and right: jump like a streaming app. Each press is 10 s; holding the key speeds up to 30 s and 1 min.
// The video jumps when the key is released for a moment (or with OK); meanwhile a frame of that point is shown.
function seekStep(dir, held) {
  if (!scrub) scrub = { t: P.pos, n: 0, timer: null };
  scrub.n = held ? scrub.n + 1 : 0;
  const step = scrub.n > 25 ? 60 : scrub.n > 8 ? 30 : 10;
  scrub.t = Math.max(0, Math.min(P.dur ? P.dur - 2 : scrub.t + step, scrub.t + dir * step));
  showUi("pbar");
  paint();
  askFrame();
  clearTimeout(scrub.timer);
  scrub.timer = setTimeout(commitSeek, 1100);
}
function commitSeek() {
  if (!scrub) return;
  clearTimeout(scrub.timer);
  P.pos = scrub.t; cmd("seek", scrub.t);
  scrub = null; lastCue = undefined;
  paint(); showUi("pbar");
}
let frameT = null, frameAsked = -1;
function askFrame() {
  if (!NATIVE || !Android.frame || !playing || playing.v.b) return;
  clearTimeout(frameT);
  frameT = setTimeout(() => {
    if (!scrub) return;
    const t = Math.round(scrub.t);
    if (t === frameAsked) return;
    frameAsked = t;
    Android.frame(srcOf(playing.v), t);
  }, 120);
}
window.tvFrame = (t, url) => { if (scrub && Math.abs(scrub.t - t) < 90) $("pthumbi").style.backgroundImage = `url(${url})`; };

function pressBtn() {
  const b = document.querySelectorAll(".pb2")[plBtn];
  const op = b && b.dataset.p;
  if (op === "toggle") return toggle();
  if (op === "speed") return openMenu("speed");
  if (op === "subs") return openMenu("subs");
  if (op === "next") {
    const n = all().find(y => playing && y.ci === playing.ci && y.vi > playing.vi);
    if (!n) return toast("Es el último episodio del curso", 3000);
    closePl(false); hideNext(); return play(n);
  }
}
function plKey(e) {
  const k = e.key;
  e.preventDefault();
  if (menu) return menuKey(k);
  const ui = $("pl").classList.contains("ui");
  if (k === "ArrowLeft" || k === "ArrowRight") {
    const dir = k === "ArrowRight" ? 1 : -1;
    if (ui && plFocus === "pbtn" && !scrub) {
      plBtn = Math.max(0, Math.min(document.querySelectorAll(".pb2").length - 1, plBtn + dir));
      return showUi("pbtn");
    }
    return seekStep(dir, e.repeat);
  }
  if (k === "MediaFastForward") return seekStep(1, e.repeat);
  if (k === "MediaRewind") return seekStep(-1, e.repeat);
  if (k === "Enter" || k === " ") {
    if (scrub) return commitSeek();
    if (ui && plFocus === "pbtn") return pressBtn();
    return toggle();
  }
  if (k === "MediaPlayPause" || k === "MediaPlay" || k === "MediaPause") return toggle();
  if (k === "ArrowUp") return showUi("pbar");
  if (k === "ArrowDown") return showUi("pbtn");
}
// Back inside the player: closes a menu, cancels a jump, or closes the video.
function plBack() {
  if (menu) { menu = null; $("pmenu").hidden = true; showUi("pbtn"); return true; }
  if (scrub) { clearTimeout(scrub.timer); scrub = null; paint(); return true; }
  closePl(false);
  return true;
}

// ---------- speed and subtitle menus ----------
let mrow = 0;
function openMenu(kind) {
  menu = kind;
  mrow = kind === "speed" ? Math.max(0, SPEEDS.indexOf(speed)) : 0;
  renderMenu();
  $("pmenu").hidden = false;
  showUi("pbtn");
}
function renderMenu() {
  let h = "";
  if (menu === "speed") {
    h = `<h4>Velocidad</h4>` + SPEEDS.map((s, i) => `<div class="mi${i === mrow ? " on" : ""}${s === speed ? " sel" : ""}">${s === 1 ? "Normal (1x)" : s + "x"}</div>`).join("") +
      `<div class="mhint">Arriba y abajo para elegir, OK para aplicar.</div>`;
  } else {
    const rows = [["Subtítulos", subset.on ? "Sí" : "No"], ["Tamaño", SIZES[subset.size][0]], ["Color", COLORS[subset.color][0]], ["Fondo", BGS[subset.bg][0]]];
    h = `<h4>Subtítulos</h4>` + rows.map((r, i) => `<div class="mi${i === mrow ? " on" : ""}"><span>${r[0]}</span><span class="v">‹ ${r[1]} ›</span></div>`).join("") +
      `<div class="mhint">Izquierda y derecha cambian la opción. OK o Atrás para cerrar.</div>`;
  }
  $("pmenu").innerHTML = h;
}
function menuKey(k) {
  const n = menu === "speed" ? SPEEDS.length : 4;
  if (k === "ArrowUp") mrow = Math.max(0, mrow - 1);
  else if (k === "ArrowDown") mrow = Math.min(n - 1, mrow + 1);
  else if ((k === "ArrowLeft" || k === "ArrowRight") && menu === "subs") {
    const d = k === "ArrowRight" ? 1 : -1, wrap = (v, len) => (v + d + len) % len;
    if (mrow === 0) subset.on = !subset.on;
    if (mrow === 1) subset.size = wrap(subset.size, SIZES.length);
    if (mrow === 2) subset.color = wrap(subset.color, COLORS.length);
    if (mrow === 3) subset.bg = wrap(subset.bg, BGS.length);
    store.set("tvsubs", JSON.stringify(subset));
    lastCue = undefined; styleSubs(); showCue();
  } else if (k === "Enter") {
    if (menu === "speed") { speed = SPEEDS[mrow]; store.set("tvspeed", String(speed)); cmd("speed", speed); }
    menu = null; $("pmenu").hidden = true; showUi("pbtn"); paint();
    return;
  }
  renderMenu(); showUi("pbtn");
}

// ---------- subtitles: 1 to 1.5 lines on screen ----------
// Same cleanup as the phone app (../zoom.js): long blocks are split into short pieces timed by length,
// repeated lines are dropped, and a piece hides once it has been on screen long enough to read it.
// On the TV a piece is at most about 60 letters, which is one line or one and a half.
const MAXC = 60;
function pieces(t) {
  if (t.length <= MAXC) return [t];
  const out = []; let cur = "";
  for (const w of t.split(" ")) {
    if (cur && (cur + " " + w).length > MAXC) { out.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
    if (cur.length >= 32 && /[.,;:?!]$/.test(w)) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}
function tidy(list) {
  const out = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    if (prev && prev.t === c.t) { prev.b = Math.min(Math.max(prev.b, c.b), prev.a + 2 + c.t.length * 0.09); continue; }
    const ps = pieces(c.t), total = ps.reduce((n, x) => n + x.length, 0);
    let at = c.a;
    for (const x of ps) {
      const end = at + (c.b - c.a) * x.length / total;
      out.push({ a: at, b: Math.min(end, at + 1.5 + x.length * 0.08), t: x });
      at = end;
    }
  }
  return out;
}
const secOf = s => s.trim().split(":").map(parseFloat).reduce((acc, x) => acc * 60 + x, 0);
async function loadSubs(x) {
  cues = []; lastCue = undefined;
  const f = await subFile(x.c, x.v);
  if (!f || playing !== x) return;
  let text = "";
  try { text = await Drive.read(f.id); } catch (_) { return; }
  if (playing !== x) return;
  const list = [];
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines2 = block.split("\n"), i = lines2.findIndex(l => l.indexOf("-->") >= 0);
    if (i < 0) continue;
    const ab = lines2[i].split("-->");
    const t = lines2.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (t) list.push({ a: secOf(ab[0]), b: secOf(ab[1].split(" ").filter(Boolean)[0]), t });
  }
  cues = tidy(list);
  styleSubs();
}
function styleSubs() {
  const s = $("psubt"), bg = BGS[subset.bg];
  s.style.fontSize = SIZES[subset.size][1] + "rem";
  s.style.color = COLORS[subset.color][1];
  s.style.background = bg[1];
  s.style.textShadow = bg[2];
}
function showCue() {
  const t = scrub ? -1 : P.pos;
  const c = subset.on && t >= 0 ? cues.find(x => t >= x.a && t <= x.b) : null;
  if (c === lastCue) return;
  lastCue = c;
  $("psub").hidden = !c; $("psubt").textContent = c ? c.t : "";
}
styleSubs();

// Redraw the current screen with the new progress, keeping the focus where it was.
function refresh() {
  const l = lines[li], keep = l ? { id: l.id, idx: mem[l.id] || 0 } : null;
  if (screen === "home") renderHome(); else if (screen === "course") renderCourse(); else if (screen === "search") renderSearch();
  if (keep) focusLine(keep.id, keep.idx);
}
function offerNext(x) {
  const n = all().find(y => y.ci === x.ci && y.vi > x.vi);
  if (!n) return toast("✔ Terminaste el curso", 4000);
  const l = lines[li]; nextBack = l ? { id: l.id, idx: mem[l.id] || 0 } : { id: "tabs", idx: 0 };
  nextX = n; let s = 8;
  $("nut").textContent = `${n.v.n}. ${n.v.t}`;
  $("nul").textContent = `Siguiente episodio en ${s}`;
  $("nextup").hidden = false; focusAt(0, 0);
  nextT = setInterval(() => { s--; $("nul").textContent = `Siguiente episodio en ${s}`; if (s <= 0) playNext(); }, 1000);
}
function hideNext() {
  clearInterval(nextT); nextT = null;
  if ($("nextup").hidden) return;
  $("nextup").hidden = true; nextX = null; focusLine(nextBack.id, nextBack.idx);
}
function playNext() { const n = nextX; hideNext(); if (n) play(n); }

// Browser without the app: <video> through ../sw.js, same controls.
function webStart(x, start) {
  const vid = $("video");
  $("wp").hidden = false;
  vid.src = x.v.b ? srcOf(x.v) : "../v/" + x.v.d;
  vid.onloadedmetadata = () => { if (start) vid.currentTime = start; vid.playbackRate = speed; vid.play().catch(() => {}); };
  vid.ontimeupdate = vid.onplaying = vid.onpause = vid.onwaiting = () =>
    window.tvState(vid.currentTime, vid.duration || 0, !vid.paused, vid.readyState < 3);
  vid.onended = () => window.tvEnded();
  vid.onerror = () => window.tvError("este navegador no pudo abrir el video");
}

// ---------- pictures and preview (home screen) ----------
// Drive makes a picture of every video (thumbnailLink). Its URL works without the token for a few hours.
const pics = new Map();
function picOf(v) {
  if (!v || !v.d) return Promise.resolve("");
  if (!pics.has(K(v))) {
    pics.set(K(v), Drive.req(FILES_API + v.d + "?fields=thumbnailLink&supportsAllDrives=true")
      .then(r => r.json()).then(m => m.thumbnailLink ? m.thumbnailLink.replace(/=s\d+$/, "=w640") : "").catch(() => ""));
  }
  return pics.get(K(v));
}
const tileVideo = el => el.dataset.v ? (IDX.get(el.dataset.v) || {}).v : el.dataset.c !== undefined ? (nextOf(C[+el.dataset.c], +el.dataset.c) || {}).v : null;
// Loads the pictures of one row, a few at a time.
async function loadPics(trk) {
  if (!trk || trk.dataset.pics) return;
  trk.dataset.pics = "1";
  const tiles = [...trk.querySelectorAll(".t")].slice(0, 14);
  for (let i = 0; i < tiles.length; i += 4) {
    await Promise.all(tiles.slice(i, i + 4).map(async el => {
      const u = await picOf(tileVideo(el));
      if (u) { const a = el.querySelector(".a"); a.style.backgroundImage = `url("${u}")`; a.classList.add("img"); }
    }));
  }
}
function loadVisiblePics() { [...document.querySelectorAll("#" + screen + " .trk")].slice(0, 4).forEach(loadPics); }
let pvT = null, previewing = false;
function stopPreview() {
  clearTimeout(pvT);
  if (previewing && NATIVE && Android.stopPreview) Android.stopPreview();
  previewing = false;
}
function heroPicture(el) {
  const v = tileVideo(el);
  $("hpic").classList.remove("on");
  picOf(v).then(u => {
    if (!u || cur() !== el) return;
    $("hpic").style.backgroundImage = `url("${u}")`; $("hpic").classList.add("on");
  });
  stopPreview();
  if (!v || !NATIVE || !Android.preview || LEGACY) return;
  // After 2 seconds on the same title, a muted piece of the video plays in the hero, like streaming apps.
  pvT = setTimeout(() => {
    if (cur() !== el || screen !== "home" || playing) return;
    const st = V(v), r = $("hpic").getBoundingClientRect();
    const start = st.pos > 30 && !st.visto ? st.pos : st.dur ? st.dur * 0.2 : 45;
    previewing = true;
    Android.preview(JSON.stringify({ url: srcOf(v), hls: !!v.b, start, x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 }));
  }, 2000);
}

// ---------- plan of the day and stats (same as the phone's "Hoy") ----------
function nextsByCat() {
  const out = [], used = new Set();
  C.forEach((c, ci) => {
    if (!c.ruta || used.has(c.cat)) return;
    const vi = c.videos.findIndex(v => !V(v).visto);
    if (vi < 0) return;
    used.add(c.cat);
    out.push({ c, ci, v: c.videos[vi], vi });
  });
  return out;
}
function planHoy() {
  if (!S.plan || S.plan.fecha !== today()) {
    S.plan = { fecha: today(), items: nextsByCat().map(x => K(x.v)), u: Date.now() };
    save(1500);
  }
  return S.plan;
}
function streak() {
  const { dias } = totals();
  let st = 0; const d = new Date();
  if (!(dias[today()] > 0)) d.setDate(d.getDate() - 1);
  while ((dias[d.toLocaleDateString("en-CA")] || 0) > 0) { st++; d.setDate(d.getDate() - 1); }
  return st;
}
function renderStats() {
  const p = planHoy(), done = p.items.filter(k => S.videos[k] && S.videos[k].visto).length;
  const ruta = C.filter(c => c.ruta), seen = ruta.reduce((n, c) => n + c.videos.filter(v => V(v).visto).length, 0);
  const total = ruta.reduce((n, c) => n + c.videos.length, 0), min = Math.round(totals().dias[today()] || 0), r = streak();
  $("stats").innerHTML = `<span><b>${done}/${p.items.length}</b>plan de hoy</span><span><b>${min}</b>min hoy</span>` +
    `<span><b>${r}</b>${r === 1 ? "día" : "días"} de racha</span><span><b>${seen}/${total}</b>Mi ruta</span>`;
}

async function startWorker() {
  if (NATIVE || !("serviceWorker" in navigator)) return;
  try {
    navigator.serviceWorker.addEventListener("message", e => {
      if (e.data && e.data.needToken && e.ports[0]) e.ports[0].postMessage({ token: Drive.valid() ? Drive.token : null });
    });
    await navigator.serviceWorker.register("../sw.js");
    const reg = await navigator.serviceWorker.ready;
    (navigator.serviceWorker.controller || reg.active).postMessage({ token: Drive.token });
  } catch (_) { /* videos from Drive will not play in this browser */ }
}

function toast(t, ms = 0) {
  clearTimeout(toast.t);
  $("toast").hidden = !t; $("toast").textContent = t;
  if (t && ms) toast.t = setTimeout(() => { $("toast").hidden = true; }, ms);
}

// ---------- pairing with the llavero ----------
async function pairScreen(msg) {
  for (const id of ["load", "home", "course", "search", "top"]) $(id).hidden = true;
  $("pair").hidden = false;
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  const code = [...a].map(b => (b % 36).toString(36)).join("") + [...a].map(b => ((b >> 3) % 36).toString(36)).join("");
  $("qr").innerHTML = "";
  new QRCode($("qr"), { text: PAIR_PAGE + code, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
  $("pcode").textContent = "Código: " + code.slice(0, 4).toUpperCase() + "-" + code.slice(4, 8).toUpperCase();
  $("pmsg").textContent = msg || "";
  const until = Date.now() + 9 * 60000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r = await fetch(LLAVERO_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ par: code }) });
      const d = await r.json();
      if (d.k) {
        store.set("llavero", JSON.stringify({ u: LLAVERO_URL, k: d.k }));
        $("pair").hidden = true; $("load").hidden = false;
        if (await Drive.fromLlavero()) return start();
        return pairScreen("El llavero no dio acceso. Vuelve a intentarlo.");
      }
      if (d.error) $("pmsg").textContent = "El llavero aún no tiene el enlace para televisores (falta actualizar Codigo.gs).";
    } catch (_) { $("pmsg").textContent = "Sin conexión con el llavero: revisa el internet del televisor."; }
  }
  pairScreen("El código venció: aquí tienes uno nuevo.");
}

// ---------- start ----------
async function loadCatalog() {
  const f = await Drive.find(ids.folder, "catalogo.json");
  if (!f) throw new Error("No encuentro catalogo.json en Mi unidad/Estudio/Netflix_PLC.");
  const key = "./_catalogo?" + encodeURIComponent(f.modifiedTime);
  let cache = null;
  try { cache = await caches.open("catalogo"); } catch (_) { /* no cache storage */ }
  let text = cache && await cache.match(key).then(r => r && r.text());
  if (!text) {
    text = await Drive.read(f.id);
    if (cache) { for (const k of await cache.keys()) await cache.delete(k); await cache.put(key, new Response(text)); }
  }
  const cat = JSON.parse(text);
  C = cat.cursos; CATS = cat.cats;
  IDX = new Map(all().map(x => [K(x.v), x]));
}
let started = false;
async function start() {
  if (NATIVE && Drive.token) Android.setToken(Drive.token);
  if (started) return;
  started = true;
  try {
    $("lmsg").textContent = "Cargando tus cursos...";
    await startWorker();
    const est = await Drive.find("root", "Estudio", true);
    if (!est) throw new Error("No encuentro la carpeta Estudio en tu Mi unidad.");
    const fol = await Drive.find(est.id, "Netflix_PLC", true);
    if (!fol) throw new Error("No encuentro la carpeta Mi unidad/Estudio/Netflix_PLC.");
    ids.folder = fol.id;
    await loadCatalog();
    await pull();
    $("load").hidden = true;
    tab("home");
    $("sync").textContent = "✔ Al día";
  } catch (e) {
    started = false;
    $("lmsg").textContent = "No se pudo cargar: " + e.message + ". Se reintenta en 20 s.";
    setTimeout(start, 20000);
  }
}
// The token lasts about 50 minutes: renew it 10 minutes before, also during a long video.
setInterval(() => { if (Drive.llavero() && Drive.minutesLeft() < 10) Drive.fromLlavero(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (!C.length) return;
  if (document.hidden) flush();
  else if (!playing) queue(pull).then(refresh).catch(() => {});
});

function boot() {
  Drive.onToken = start;
  Drive.onExpired = () => { if (!Drive.llavero()) pairScreen(); };
  try {
    const s = JSON.parse(store.get("gtoken") || "null");
    if (s && s.exp > Date.now() + 60000) { Drive.token = s.t; Drive.exp = s.exp; }
  } catch (_) { /* no saved token */ }
  if (!Drive.llavero()) return pairScreen();
  if (Drive.valid()) return start();
  Drive.fromLlavero().then(ok => { if (!ok) pairScreen("El llavero no respondió. Si cambiaste la clave, vuelve a enlazar el televisor."); });
}
boot();
