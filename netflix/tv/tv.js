// Netflix PLC for the TV: streaming only (no activities, notes or quizzes).
// Runs inside the Android TV app (repository folder tv-app/), which adds a native video player
// (window.Android), or in any TV browser, where it plays with <video> and ../sw.js.
// It reads and writes the same Drive files as the phone and PC app (../app.js), with the same merge rules,
// so a video left at minute 12 on the phone goes on at minute 12 on the TV, and back.
// Sign-in: the TV is paired once with the user's "llavero" (Apps Script, see llavero/Codigo.gs on the PC)
// by scanning a QR code with the phone. The web app URL below is not secret: without the key it gives nothing.
const LLAVERO_URL = "https://script.google.com/macros/s/AKfycbx-7bEIOzLJk61_ASIheRzdZLOZJO_IcDMMPFve-FoGjMXbCfkTHvrEhX3TP1O3S5MbXA/exec";
const PAIR_PAGE = "https://jazzkevmel-arch.github.io/rclone-kevin/netflix/tv/enlazar.html#";
const API = "https://www.googleapis.com/drive/v3/files/";
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
const V = v => (S.videos[K(v)] ||= { pos: 0, dur: 0, visto: false, act: false, nota: "", u: 0 });
const touch = v => { V(v).u = Date.now(); };
// Only what plays on the TV: Drive videos (d) and Control Más+ lessons with their stream (b).
const playable = v => !!(v.d || v.b);
const all = () => C.flatMap((c, ci) => c.videos.map((v, vi) => ({ c, ci, v, vi }))).filter(x => playable(x.v));
const pct = v => { const st = V(v); return st.visto ? 100 : st.dur ? Math.min(100, st.pos / st.dur * 100) : 0; };

// ---------- minutes and sync (same rules as ../app.js) ----------
function addMin(cat, m) {
  const d = today(), md = (S.md[DEV] ||= {}), day = (md[d] ||= {});
  day[cat] = (day[cat] || 0) + m;
}
function totals() {
  const dias = {}, diasCat = {};
  for (const days of Object.values(S.md)) for (const [d, cats] of Object.entries(days)) for (const [c, m] of Object.entries(cats)) {
    dias[d] = (dias[d] || 0) + m;
    (diasCat[d] ||= {})[c] = ((diasCat[d] || {})[c] || 0) + m;
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
    const mine = (S.md[DEV] ||= {});
    for (const [d, cats] of Object.entries(days)) for (const [c, m] of Object.entries(cats)) {
      const day = (mine[d] ||= {});
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
  if (!$("wp").hidden) return wpKey(e);
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
  if (homeMode === "home") {
    h += rowHtml("cont", "Continuar viendo", continuing().map(x => tileHtml(x)).join(""));
    const nx = C.map((c, ci) => c.ruta ? nextOf(c, ci) : null).filter(Boolean);
    h += rowHtml("nx", "Siguiente en tu ruta", nx.map(x => tileHtml(x)).join(""));
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
onFocus = el => { if (screen === "home") heroFor(el); };

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
let playing = null, lastTick = null, nextX = null, nextT = null, nextBack = null;
async function subUrl(c, v) {
  try {
    ids.subs ??= (await Drive.find(ids.folder, "subtitulos", true)) || null;
    if (!ids.subs) return "";
    const d = await Drive.find(ids.subs.id, c.id, true);
    if (!d) return "";
    const f = await Drive.find(d.id, String(v.n).padStart(2, "0") + ".vtt");
    return f ? API + f.id + "?alt=media" : "";
  } catch (_) { return ""; }
}
const srcOf = v => v.b ? BUNNY + v.b + "/playlist.m3u8" : API + v.d + "?alt=media&supportsAllDrives=true";
async function play(x, fromZero) {
  hideNext();
  toast("Abriendo...");
  await Promise.race([queue(pull).catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  const st = V(x.v);
  const start = !fromZero && st.pos > 5 && (!st.dur || st.pos < st.dur - 15) ? st.pos : 0;
  S.ultimo = K(x.v); S.uu = Date.now(); save(1500);
  playing = x; lastTick = null;
  const title = `${short(x.c.title)} · ${x.v.n}. ${x.v.t}`;
  if (!Drive.valid()) await Drive.fromLlavero();
  if (NATIVE) {
    const sub = await Promise.race([subUrl(x.c, x.v), new Promise(r => setTimeout(() => r(""), 2500))]);
    toast("");
    Android.play(JSON.stringify({ url: srcOf(x.v), hls: !!x.v.b, token: Drive.token || "", start: Math.floor(start * 1000), title, sub }));
  } else {
    toast("");
    webPlay(x, start, title);
  }
}
// Progress from the player (native: every 5 s; browser: timeupdate). pos and dur in seconds.
window.tvProgress = (pos, dur, isPlaying) => {
  if (!playing) return;
  const { c, v } = playing, st = V(v), now = Date.now();
  if (isPlaying && lastTick) addMin(c.cat, Math.min(5, (now - lastTick) / 60000));
  lastTick = isPlaying ? now : null;
  if (dur > 0) st.dur = dur;
  st.pos = pos; touch(v);
  if (st.dur && pos / st.dur >= 0.9 && !st.visto) { st.visto = true; st.vf = today(); save(1500); }
  else save();
};
window.tvClosed = (pos, dur, ended) => {
  if (!playing) return;
  window.tvProgress(pos, dur, false);
  const x = playing; playing = null; lastTick = null;
  if (ended) { const st = V(x.v); if (!st.visto) { st.visto = true; st.vf = today(); touch(x.v); } }
  save(800);
  refresh();
  if (ended) offerNext(x);
};
window.tvError = msg => { toast("No se pudo reproducir: " + msg, 5000); if (playing) window.tvClosed(V(playing.v).pos, V(playing.v).dur, false); };
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

// Browser player (TV browsers without the app): <video> through ../sw.js.
function webPlay(x, start, title) {
  const vid = $("video");
  $("wp").hidden = false; $("wpt").textContent = title;
  vid.src = x.v.b ? srcOf(x.v) : "../v/" + x.v.d;
  vid.onloadedmetadata = () => { if (start) vid.currentTime = start; vid.play().catch(() => {}); };
  vid.ontimeupdate = () => { if (Math.random() < 0.2) window.tvProgress(vid.currentTime, vid.duration || 0, !vid.paused); };
  vid.onended = () => closeWeb(true);
  vid.onerror = () => { closeWeb(false); toast("Este navegador no pudo abrir el video. Usa la app de TV.", 5000); };
}
function closeWeb(ended) {
  const vid = $("video");
  const pos = vid.currentTime, dur = vid.duration || 0;
  vid.pause(); vid.removeAttribute("src"); vid.load(); $("wp").hidden = true;
  window.tvClosed(pos, dur, ended);
}
function wpKey(e) {
  const vid = $("video");
  e.preventDefault();
  if (e.key === "Enter" || e.key === " " || e.key === "MediaPlayPause") vid.paused ? vid.play() : vid.pause();
  else if (e.key === "ArrowRight") vid.currentTime += 10;
  else if (e.key === "ArrowLeft") vid.currentTime -= 10;
  else if (["Escape", "Backspace", "GoBack", "BrowserBack"].includes(e.key)) closeWeb(false);
  $("wpt").style.opacity = 1; clearTimeout(wpKey.t); wpKey.t = setTimeout(() => { $("wpt").style.opacity = 0; }, 3000);
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
