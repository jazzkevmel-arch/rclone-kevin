// Repasa: study app built on the transcripts of Kevin's courses.
// Screens are drawn from the hash route (#/hoy, #/curso/<id>, #/leccion/<id>/<n>/<modo>, ...).
// Data: see datos.js (Drive) and ia.js (Gemini).

const $ = id => document.getElementById(id);
const V = () => $("view");
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = (d) => { const x = d ? new Date(d) : new Date(); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return today(d); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const fmtDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short" });
const pl = (n, one, many) => n + " " + (n === 1 ? one : many);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  cards: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/></svg>',
  quiz: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg>',
  tf: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 .8 1.2 1.5 1.6 2.3 1.6C11 7.5 11 5 12 3Z"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
};

// ---------- State ----------
let CAT = { cursos: [] }, NB = { videos: {}, tarjetas: {} }, IDX = {}, CFG = {};
let P = null;                 // progress, see blank()
const CC = {};                // lesson content cache: "curso/n" -> content
const TUT = {};               // tutor chat history per context key
let DEV = "web";
try { DEV = localStorage.getItem("repasa_dev") || ("d" + Math.random().toString(36).slice(2, 8)); localStorage.setItem("repasa_dev", DEV); } catch (_) { /* storage blocked */ }

const blank = () => ({ cards: {}, lec: {}, dias: {}, exam: {}, fallos: {}, ult: null });
const LK = (c, n) => c + "/" + n;
const course = id => CAT.cursos.find(c => c.id === id);
const lessonsOf = c => (IDX[c.id] || []).map(n => c.videos.find(v => v.n === n) || { n, t: "Lección " + n }).sort((a, b) => a.n - b.n);
const studyCourses = () => CAT.cursos.filter(c => IDX[c.id] && IDX[c.id].length);
const nbKey = v => v.p || v.id;

function toast(msg, ms) {
  const t = $("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), ms || 2600);
}
function sync(msg) { $("sync").textContent = msg || ""; }

// ---------- Progress: merge and save ----------
function merge(a, b) {
  const out = blank();
  for (const k of ["cards", "lec", "exam", "fallos"]) {
    const x = a[k] || {}, y = b[k] || {};
    for (const id of new Set(Object.keys(x).concat(Object.keys(y)))) {
      out[k][id] = !y[id] || (x[id] && (x[id].u || 0) >= (y[id].u || 0)) ? x[id] : y[id];
    }
  }
  const da = a.dias || {}, db = b.dias || {};
  for (const d of new Set(Object.keys(da).concat(Object.keys(db)))) {
    out.dias[d] = {};
    const pa = da[d] || {}, pb = db[d] || {};
    for (const dev of new Set(Object.keys(pa).concat(Object.keys(pb)))) {
      const u = pa[dev] || { m: 0, x: 0 }, w = pb[dev] || { m: 0, x: 0 };
      out.dias[d][dev] = { m: Math.max(u.m || 0, w.m || 0), x: Math.max(u.x || 0, w.x || 0) };
    }
  }
  out.ult = (a.ult && (!b.ult || a.ult.u >= b.ult.u)) ? a.ult : b.ult;
  return out;
}
let saveT = null, saving = false, dirty = false;
function save() { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 2500); sync("Guardando…"); }
async function flush() {
  if (saving || !dirty) return;
  saving = true; dirty = false;
  try {
    const remote = await Store.progress();
    if (remote) P = merge(P, remote);
    await Store.saveProgress(P);
    sync("✔ Guardado");
  } catch (e) { dirty = true; sync("Sin guardar: se reintenta"); setTimeout(flush, 30000); }
  saving = false;
  if (dirty) save();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

// ---------- Activity, streak ----------
let lastAct = Date.now();
function act(items) {
  lastAct = Date.now();
  if (!items) return;
  const d = today(); P.dias[d] = P.dias[d] || {}; const m = P.dias[d][DEV] = P.dias[d][DEV] || { m: 0, x: 0 };
  m.x += items; save();
}
setInterval(() => {
  if (!P || document.visibilityState !== "visible" || Date.now() - lastAct > 90000) return;
  const d = today(); P.dias[d] = P.dias[d] || {}; const m = P.dias[d][DEV] = P.dias[d][DEV] || { m: 0, x: 0 };
  m.m += 1; save();
}, 60000);
["click", "keydown", "touchstart"].forEach(e => document.addEventListener(e, () => { lastAct = Date.now(); }, { passive: true }));
const dayTotal = d => { const o = (P.dias[d] || {}); let m = 0, x = 0; for (const k in o) { m += o[k].m || 0; x += o[k].x || 0; } return { m, x }; };
const studied = d => { const t = dayTotal(d); return t.m > 0 || t.x > 0; };
function streak() {
  let d = today(), n = 0;
  if (!studied(d)) d = addDays(d, -1);
  while (studied(d)) { n++; d = addDays(d, -1); }
  return n;
}

// ---------- Spaced repetition (SM-2 style) ----------
// Next interval in days for grade g (0 again, 3 hard, 4 good, 5 easy) given the card's state.
function nextInterval(c, g) {
  if (g < 3) return 0;
  const r = c.r + 1;
  if (r === 1) return g === 5 ? 4 : 1;
  if (r === 2) return g === 3 ? 2 : g === 4 ? 3 : 6;
  return Math.max(c.i + 1, Math.round(c.i * c.e * (g === 3 ? 0.8 : g === 5 ? 1.3 : 1)));
}
function grade(key, g, card) {
  const c = P.cards[key] || { e: 2.5, i: 0, r: 0 };
  c.i = nextInterval(c, g);
  if (g < 3) { c.r = 0; c.e = Math.max(1.3, c.e - 0.2); }
  else { c.r += 1; c.e = Math.max(1.3, c.e + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02))); }
  c.d = addDays(today(), c.i); c.g = g; c.u = Date.now();
  c.f = card.f; c.b = card.b; c.l = card.l;
  P.cards[key] = c; act(1);
}
const dueCards = () => Object.keys(P.cards).filter(k => P.cards[k].d <= today()).map(k => Object.assign({ key: k }, P.cards[k]));
function badge() { const n = dueCards().length; const b = $("due-badge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : n; }

// ---------- Mastery ----------
function mastery(lk) {
  const L = P.lec[lk] || {}, parts = [];
  if (L.q != null) parts.push(L.q);
  if (L.t != null) parts.push(L.t);
  if (L.n) {
    let good = 0;
    for (let i = 0; i < L.n; i++) { const c = P.cards[lk + "#" + i]; if (c && c.g >= 4) good++; }
    if (Object.keys(P.cards).some(k => k.indexOf(lk + "#") === 0)) parts.push(Math.round(good * 100 / L.n));
  }
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
}
const courseMastery = c => { const ls = lessonsOf(c); return ls.length ? Math.round(ls.reduce((a, v) => a + mastery(LK(c.id, v.n)), 0) / ls.length) : 0; };
function setLec(lk, field, val, keepBest) {
  const L = P.lec[lk] = P.lec[lk] || {};
  L[field] = keepBest && L[field] != null ? Math.max(L[field], val) : val;
  L.u = Date.now(); save();
}
const ring = p => `<div class="ring" style="--p:${p}"><span>${p}%</span></div>`;

// ---------- Exam plan ----------
function plan(c) {
  const ex = P.exam[c.id]; if (!ex || !ex.f) return null;
  const left = Math.max(1, daysBetween(today(), ex.f) + 1);
  const todo = lessonsOf(c).filter(v => mastery(LK(c.id, v.n)) < ex.meta);
  const per = Math.ceil(todo.length / left);
  return { ex, left, todo, per, hoy: todo.slice(0, per) };
}

// ---------- Lesson content ----------
async function content(c, n, regen) {
  const lk = LK(c.id, n);
  if (!regen && CC[lk]) return CC[lk];
  let d = regen ? null : await Store.content(c.id, n);
  const v = c.videos.find(x => x.n === n) || {};
  const nbq = NB.videos[nbKey(v)], nbc = NB.tarjetas[nbKey(v)];
  if (!d) {
    if (IA.key) {
      const tr = await Store.transcript(c.id, n);
      if (!tr) throw new Error("No encuentro la transcripción de esta lección en Drive.");
      d = await IA.lesson(c.title, v.t || ("Lección " + n), tr);
      d.modelo = IA.model; d.fecha = today();
      if (nbq && nbq.length) d.quiz = nbq.concat(d.quiz).slice(0, 10);
      if (nbc && nbc.length) d.tarjetas = nbc.concat(d.tarjetas).slice(0, 16);
      await Store.saveContent(c.id, n, d);
    } else if (nbq || nbc) {
      d = { resumen: null, vf: null, quiz: nbq || [], tarjetas: nbc || [], fuente: "notebooklm" };
    } else return null;
  }
  CC[lk] = d;
  const L = P.lec[lk] = P.lec[lk] || {};
  if (L.n !== (d.tarjetas || []).length) { L.n = (d.tarjetas || []).length; L.u = L.u || Date.now(); }
  return d;
}

// ---------- Router ----------
let started = false;
function route() {
  if (!started) return;
  const parts = (location.hash.replace(/^#\/?/, "") || "hoy").split("/").map(decodeURIComponent);
  const tab = parts[0];
  document.body.classList.remove("full");
  document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.t === tab || (tab === "curso" || tab === "leccion") && a.dataset.t === "cursos"));
  window.scrollTo(0, 0);
  badge();
  try {
    if (tab === "hoy") return viewHoy();
    if (tab === "cursos") return viewCursos();
    if (tab === "curso") return viewCurso(parts[1]);
    if (tab === "leccion") return viewLeccion(parts[1], +parts[2], parts[3]);
    if (tab === "repasar") return parts[1] === "fallos" ? viewFallos() : viewRepasar(parts[1] === "ya");
    if (tab === "tutor") return viewTutor(null);
    if (tab === "progreso") return viewProgreso();
    if (tab === "ajustes") return viewAjustes();
    viewHoy();
  } catch (e) { V().innerHTML = `<div class="empty"><h2>Algo falló</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener("hashchange", route);
const go = h => { location.hash = h; };

// ---------- Screens ----------
function lessonRow(c, v, sub) {
  const lk = LK(c.id, v.n);
  return `<a class="item" href="#/leccion/${encodeURIComponent(c.id)}/${v.n}">${ring(mastery(lk))}
    <div class="grow"><div class="t">${esc(v.t)}</div><div class="s">${esc(sub || (v.s || ""))}</div></div>${ICON.chev}</a>`;
}

function viewHoy() {
  const s = streak(), due = dueCards().length, t = dayTotal(today());
  const ult = P.ult && course(P.ult.c);
  let h = `<div class="card hero"><div class="row between"><div><p class="muted small" style="margin:0">${new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" })}</p>
    <h1>${s ? "Racha de " + s + " día" + (s > 1 ? "s" : "") : "Empieza tu racha hoy"}</h1></div></div>
    <div class="stats"><div class="stat"><b>${t.m}</b><span>min hoy</span></div><div class="stat"><b>${t.x}</b><span>ejercicios hoy</span></div><div class="stat"><b>${due}</b><span>por repasar</span></div></div></div>`;
  if (!IA.key) h += `<a class="card tap row" href="#/ajustes" style="margin-top:12px;border-color:#3b3220"><span class="tag ac">Falta 1 paso</span><div class="grow small">Agrega tu clave gratis de Gemini para generar resúmenes, quizzes y usar el tutor.</div>${ICON.chev}</a>`;
  if (due) h += `<div class="section"><a class="btn primary block" href="#/repasar">${ICON.cards} Repasar ${due} tarjeta${due > 1 ? "s" : ""}</a></div>`;
  const plans = studyCourses().map(c => ({ c, p: plan(c) })).filter(x => x.p);
  if (plans.length) {
    h += `<div class="section"><h2>Tu plan de hoy</h2>`;
    for (const { c, p } of plans) {
      h += `<p class="muted small">${esc(c.title)} · examen ${fmtDate(p.ex.f)} · ${p.left} día${p.left > 1 ? "s" : ""} · ${p.todo.length} lecciones bajo ${p.ex.meta}%</p>`;
      h += p.hoy.length ? p.hoy.map(v => lessonRow(c, v)).join("") : `<div class="item"><div class="grow t">¡Curso listo para el examen! 🎯</div></div>`;
    }
    h += `</div>`;
  }
  if (ult) {
    const v = lessonsOf(ult).find(x => x.n === P.ult.n);
    if (v) h += `<div class="section"><h2>Continuar</h2>${lessonRow(ult, v, ult.title)}</div>`;
  }
  if (!plans.length) {
    h += `<div class="section"><h2>¿Tienes un examen?</h2><a class="card tap row" href="#/cursos"><div class="ic" style="color:var(--ac)">${ICON.spark}</div><div class="grow"><b>Arma tu plan</b><div class="muted small">Elige un curso, pon la fecha y la meta. Repasa reparte las lecciones por día.</div></div>${ICON.chev}</a></div>`;
  }
  V().innerHTML = h;
}

function viewCursos() {
  const cs = studyCourses();
  let h = `<h1 style="margin:8px 0 4px">Cursos</h1><p class="muted small" style="margin:0 0 14px">Solo los que tienen transcripciones (${cs.reduce((a, c) => a + IDX[c.id].length, 0)} lecciones).</p>`;
  if (!cs.length) h += `<div class="empty">No hay transcripciones en <b>Mi unidad/Estudio/Repasa/transcripciones</b>.<br>Súbelas con <code>subir_transcripciones.py</code>.</div>`;
  for (const c of cs) {
    const m = courseMastery(c), ex = P.exam[c.id];
    h += `<a class="item" href="#/curso/${encodeURIComponent(c.id)}">${ring(m)}<div class="grow"><div class="t">${esc(c.title)}</div>
      <div class="s">${IDX[c.id].length} lecciones${ex && ex.f ? " · examen " + fmtDate(ex.f) : ""}</div></div>${ICON.chev}</a>`;
  }
  V().innerHTML = h;
}

function viewCurso(id) {
  const c = course(id); if (!c) return go("#/cursos");
  const p = plan(c), ex = P.exam[c.id] || {}, m = courseMastery(c);
  let h = `<button class="back" onclick="go('#/cursos')">${ICON.back} Cursos</button>
    <div class="row">${ring(m)}<div class="grow"><h2>${esc(c.title)}</h2><p class="muted small" style="margin:2px 0 0">${esc(c.cat || "")} · ${IDX[c.id].length} lecciones</p></div></div>
    <div class="card section"><h3>${p ? "Examen el " + fmtDate(ex.f) : "Plan de examen"}</h3>
    ${p ? `<p class="muted small">Meta ${ex.meta}% · faltan ${p.left} día${p.left > 1 ? "s" : ""} · ${p.todo.length} lecciones por subir · <b style="color:var(--ac2)">${p.per} por día</b></p>` : `<p class="muted small">Pon la fecha y la meta. Repasa reparte las lecciones que te faltan entre los días que quedan.</p>`}
    <div class="row" style="gap:8px"><input class="in" type="date" id="exf" value="${esc(ex.f || "")}" min="${today()}" style="flex:1.4">
    <select class="in" id="exm" style="flex:1">${[60, 70, 80, 90, 100].map(x => `<option value="${x}"${(ex.meta || 80) === x ? " selected" : ""}>Meta ${x}%</option>`).join("")}</select></div>
    <div class="row" style="margin-top:10px"><button class="btn primary grow" id="exsave">${p ? "Actualizar" : "Crear plan"}</button>${p ? `<button class="btn ghost" id="exdel">Quitar</button>` : ""}</div></div>
    <div class="section"><h2>Lecciones</h2>${lessonsOf(c).map(v => lessonRow(c, v, "Lección " + v.n + (v.s ? " · " + v.s : ""))).join("")}</div>`;
  V().innerHTML = h;
  $("exsave").onclick = () => {
    const f = $("exf").value; if (!f) return toast("Elige la fecha del examen.");
    P.exam[c.id] = { f, meta: +$("exm").value, u: Date.now() }; save(); toast("Plan listo"); viewCurso(id);
  };
  if ($("exdel")) $("exdel").onclick = () => { P.exam[c.id] = { u: Date.now() }; save(); viewCurso(id); };
}

async function viewLeccion(cid, n, modo) {
  const c = course(cid); if (!c) return go("#/cursos");
  const v = lessonsOf(c).find(x => x.n === n); if (!v) return go("#/curso/" + cid);
  const lk = LK(cid, n);
  P.ult = { c: cid, n, u: Date.now() }; save();
  if (modo === "tutor") return viewTutor({ c, v });
  V().innerHTML = `<div class="spin"></div><p class="empty" style="padding-top:0">Preparando tu lección…<br><span class="small">La primera vez la IA lee la clase (unos 20 s).</span></p>`;
  let d;
  try { d = await content(c, n); }
  catch (e) { V().innerHTML = `<button class="back" onclick="go('#/curso/${esc(cid)}')">${ICON.back} Curso</button><div class="empty"><h2>No se pudo preparar</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="route()">Reintentar</button></div>`; return; }
  if (location.hash.indexOf("#/leccion/" + encodeURIComponent(cid) + "/" + n) !== 0 && location.hash.indexOf("#/leccion/" + cid + "/" + n) !== 0) return; // user moved on
  if (modo === "resumen") return viewResumen(c, v, d);
  if (modo === "tarjetas") return viewTarjetas(c, v, d);
  if (modo === "quiz") return viewQuiz(c, v, d, "quiz");
  if (modo === "vf") return viewQuiz(c, v, d, "vf");
  const L = P.lec[lk] || {}, base = `#/leccion/${encodeURIComponent(cid)}/${n}/`;
  const need = !IA.key ? " · necesita clave" : "";
  const has = k => d && d[k] && d[k].length;
  V().innerHTML = `<button class="back" onclick="go('#/curso/${esc(cid)}')">${ICON.back} ${esc(c.title)}</button>
    <div class="row">${ring(mastery(lk))}<div class="grow"><p class="muted small" style="margin:0">Lección ${n}${v.s ? " · " + esc(v.s) : ""}</p><h2>${esc(v.t)}</h2></div></div>
    <div class="modes section">
      <a class="mode" href="${base}resumen"><div class="ic">${ICON.text}</div><b>Resumen</b><span>${has("resumen") ? "Ideas clave de la clase" : "Con IA" + need}</span></a>
      <a class="mode" href="${base}tarjetas"><div class="ic">${ICON.cards}</div><b>Tarjetas</b><span>${has("tarjetas") ? pl(d.tarjetas.length, "tarjeta", "tarjetas") : "Con IA" + need}</span></a>
      <a class="mode" href="${base}quiz"><div class="ic">${ICON.quiz}</div><b>Quiz</b><span>${has("quiz") ? pl(d.quiz.length, "pregunta", "preguntas") + (L.q != null ? " · mejor " + L.q + "%" : "") : "Con IA" + need}</span></a>
      <a class="mode" href="${base}vf"><div class="ic">${ICON.tf}</div><b>Verdadero o falso</b><span>${has("vf") ? pl(d.vf.length, "frase", "frases") + (L.t != null ? " · mejor " + L.t + "%" : "") : "Con IA" + need}</span></a>
      <a class="mode wide" href="${base}tutor"><div class="ic">${ICON.chat}</div><div class="grow"><b>Pregúntale al tutor</b><br><span>Conoce esta clase. Puedes mandarle una foto.</span></div>${ICON.chev}</a>
    </div>
    ${d && d.fuente === "notebooklm" ? `<p class="muted small">Tarjetas y quiz de tu cuaderno de NotebookLM.</p>` : ""}
    ${IA.key && d && !d.fuente ? `<p class="small" style="text-align:center"><button class="btn ghost" id="regen">Volver a generar con IA</button></p>` : ""}`;
  if ($("regen")) $("regen").onclick = async () => {
    if (!confirm("¿Generar de nuevo el material de esta lección? Tu avance se mantiene.")) return;
    V().innerHTML = `<div class="spin"></div><p class="empty">Generando de nuevo…</p>`;
    try { await content(c, n, true); toast("Material nuevo listo"); } catch (e) { toast(e.message, 4000); }
    route();
  };
}

function needKey(c, v, what) {
  V().innerHTML = `<button class="back" onclick="history.back()">${ICON.back} Lección</button><div class="empty"><h2>${what} necesita la IA</h2>
    <p>Agrega tu clave gratis de Gemini y Repasa lo arma con la transcripción de esta clase.</p><a class="btn primary" href="#/ajustes">Ir a Ajustes</a></div>`;
}

function viewResumen(c, v, d) {
  if (!d || !d.resumen || !d.resumen.length) return needKey(c, v, "El resumen");
  const lk = LK(c.id, v.n);
  setLec(lk, "r", 1);
  V().innerHTML = `<button class="back" onclick="history.back()">${ICON.back} Lección</button><h2>${esc(v.t)}</h2><p class="muted small">Resumen de la clase</p>
    ${d.resumen.map(s => `<div class="card sum"><h3>${esc(s.titulo)}</h3><p>${md(s.texto)}</p></div>`).join("")}
    <div class="section row"><a class="btn primary grow" href="#/leccion/${encodeURIComponent(c.id)}/${v.n}/tarjetas">Practicar con tarjetas</a></div>`;
  act(1);
}

// Flashcard session. cards: [{ key, f, b, l }]. Cards graded "Otra vez" come back at the end.
function cardSession(cards, title, backHash, onDone) {
  document.body.classList.add("full");
  let q = cards.slice(), i = 0, done = 0, total = cards.length;
  const draw = () => {
    if (!q.length) {
      V().innerHTML = `<div class="result"><div class="big">✔</div><h2>¡Sesión terminada!</h2><p class="muted">${total} tarjeta${total > 1 ? "s" : ""} repasada${total > 1 ? "s" : ""}. Volverán cuando toque repasarlas.</p>
        <a class="btn primary block" href="${backHash}">Listo</a></div>`;
      onDone && onDone(); return;
    }
    const k = q[0];
    V().innerHTML = `<div class="progress-top"><button class="icon-btn" onclick="go('${backHash}')">${ICON.x}</button><div class="bar"><i style="width:${Math.round(done * 100 / total)}%"></i></div><span class="small muted">${done}/${total}</span></div>
      <p class="muted small" style="margin:0">${esc(title)}</p>
      <div class="flash" id="fl"><div class="flash-in"><div class="face"><small>Pregunta</small>${esc(k.f)}</div><div class="face back"><small>Respuesta</small>${esc(k.b)}</div></div></div>
      <div id="ga"><button class="btn primary block" id="show" style="margin-top:14px">Mostrar respuesta</button></div>`;
    const reveal = () => {
      $("fl").classList.add("on");
      const prev = P.cards[k.key];
      const nx = g => { const iv = nextInterval(prev || { e: 2.5, i: 0, r: 0 }, g); return !iv ? "hoy" : iv === 1 ? "1 día" : iv + " días"; };
      $("ga").innerHTML = `<div class="grades"><button class="g0" data-g="0">Otra vez<small>${nx(0)}</small></button><button class="g3" data-g="3">Difícil<small>${nx(3)}</small></button><button class="g4" data-g="4">Bien<small>${nx(4)}</small></button><button class="g5" data-g="5">Fácil<small>${nx(5)}</small></button></div>`;
      $("ga").querySelectorAll("button").forEach(b => b.onclick = () => {
        const g = +b.dataset.g; grade(k.key, g, k); q.shift();
        if (g < 3) q.push(k); else done++;
        draw();
      });
    };
    $("show").onclick = reveal; $("fl").onclick = () => { if (!$("fl").classList.contains("on")) reveal(); };
  };
  draw();
}

function viewTarjetas(c, v, d) {
  if (!d || !d.tarjetas || !d.tarjetas.length) return needKey(c, v, "Las tarjetas");
  const lk = LK(c.id, v.n), base = "#/leccion/" + encodeURIComponent(c.id) + "/" + v.n;
  const cards = d.tarjetas.map((t, i) => ({ key: lk + "#" + i, f: t.f, b: t.b, l: lk }));
  const fresh = cards.filter(k => !P.cards[k.key] || P.cards[k.key].d <= today());
  cardSession(fresh.length ? fresh : cards, v.t, base, () => setLec(lk, "c", Date.now()));
}

// Quiz (A/B/C/D) or true/false. Wrong answers go to "Mis fallos".
function viewQuiz(c, v, d, kind) {
  const items = kind === "quiz" ? d && d.quiz : d && d.vf;
  if (!items || !items.length) return needKey(c, v, kind === "quiz" ? "El quiz" : "Verdadero o falso");
  document.body.classList.add("full");
  const lk = LK(c.id, v.n), base = "#/leccion/" + encodeURIComponent(c.id) + "/" + v.n;
  const order = shuffle(items.map((_, i) => i));
  let pos = 0, ok = 0;
  const draw = () => {
    if (pos >= order.length) {
      const pct = Math.round(ok * 100 / order.length);
      setLec(lk, kind === "quiz" ? "q" : "t", pct, true);
      V().innerHTML = `<div class="result"><div class="big">${pct}%</div><h2>${pct >= 80 ? "¡Muy bien!" : pct >= 50 ? "Vas bien" : "A repasar"}</h2>
        <p class="muted">${ok} de ${order.length} correctas. Dominio de la lección: ${mastery(lk)}%.</p>
        <div class="stack"><button class="btn primary block" onclick="route()">Intentar de nuevo</button><a class="btn block" href="${base}">Volver a la lección</a></div></div>`;
      return;
    }
    const i = order[pos], it = items[i];
    const head = `<div class="progress-top"><button class="icon-btn" onclick="go('${base}')">${ICON.x}</button><div class="bar"><i style="width:${Math.round(pos * 100 / order.length)}%"></i></div><span class="small muted">${pos + 1}/${order.length}</span></div>`;
    if (kind === "quiz") {
      V().innerHTML = head + `<div class="q">${esc(it.q)}</div><div class="opts">${it.o.map((o, j) => `<button class="opt" data-j="${j}"><span class="k">${"ABCD"[j] || j + 1}</span><span>${esc(o)}</span></button>`).join("")}</div><div id="after"></div>`;
    } else {
      V().innerHTML = head + `<p class="muted small" style="margin:0 0 8px">¿Verdadero o falso?</p><div class="q">${esc(it.s)}</div><div class="tf"><button class="opt" data-j="1">Verdadero</button><button class="opt" data-j="0">Falso</button></div><div id="after"></div>`;
    }
    const right = kind === "quiz" ? it.c : (it.v ? 1 : 0);
    V().querySelectorAll(".opt").forEach(b => b.onclick = () => {
      if (V().querySelector(".opt.ok")) return;
      const j = +b.dataset.j, good = j === right;
      V().querySelectorAll(".opt").forEach(x => { if (+x.dataset.j === right) x.classList.add("ok"); });
      if (!good) b.classList.add("bad");
      if (good) ok++;
      const fk = lk + "|" + kind + "|" + i;
      if (!good) P.fallos[fk] = { u: Date.now(), ok: false };
      else if (P.fallos[fk] && !P.fallos[fk].ok) P.fallos[fk] = { u: Date.now(), ok: true };
      act(1);
      $("after").innerHTML = `<div class="expl" style="margin-top:14px"><b style="color:${good ? "var(--ok)" : "var(--bad)"}">${good ? "Correcto." : "Incorrecto."}</b> ${esc(it.e || "")}</div>
        <button class="btn primary block" style="margin-top:14px" id="next">${pos + 1 < order.length ? "Siguiente" : "Ver resultado"}</button>`;
      $("next").onclick = () => { pos++; draw(); };
      $("next").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  draw();
}

function viewRepasar(start) {
  const due = dueCards();
  const fallos = Object.keys(P.fallos).filter(k => !P.fallos[k].ok).length;
  if (start && due.length) {
    const byLesson = {};
    return cardSession(shuffle(due).slice(0, 40).map(k => ({ key: k.key, f: k.f, b: k.b, l: k.l })), "Repaso del día", "#/repasar", () => {});
  }
  const next = Object.values(P.cards).filter(c => c.d > today()).map(c => c.d).sort()[0];
  const total = Object.keys(P.cards).length, learned = Object.values(P.cards).filter(c => c.i >= 7).length;
  V().innerHTML = `<h1 style="margin:8px 0 14px">Repasar</h1>
    <div class="card hero"><h2>${due.length ? due.length + " tarjeta" + (due.length > 1 ? "s" : "") + " para hoy" : "Nada pendiente hoy"}</h2>
    <p class="muted small">${due.length ? "Repasar justo antes de olvidar es lo que fija la memoria." : next ? "Tu próximo repaso es el " + fmtDate(next) + "." : "Estudia las tarjetas de una lección y aparecerán aquí cuando toque repasarlas."}</p>
    ${due.length ? `<a class="btn primary block" href="#/repasar/ya">Empezar repaso</a>` : ""}</div>
    <div class="stats section"><div class="stat card"><b>${total}</b><span>tarjetas vistas</span></div><div class="stat card"><b>${learned}</b><span>aprendidas (7+ días)</span></div><div class="stat card"><b>${fallos}</b><span>fallos por corregir</span></div></div>
    <div class="section"><a class="item" href="#/repasar/fallos"><div class="num" style="color:var(--bad)">${fallos}</div><div class="grow"><div class="t">Mis fallos</div><div class="s">Preguntas de quiz y V/F que fallaste, por lección</div></div>${ICON.chev}</a></div>`;
}

function viewFallos() {
  const by = {};
  for (const k in P.fallos) { if (P.fallos[k].ok) continue; const lk = k.split("|")[0]; by[lk] = (by[lk] || 0) + 1; }
  const keys = Object.keys(by);
  let h = `<button class="back" onclick="go('#/repasar')">${ICON.back} Repasar</button><h2>Mis fallos</h2><p class="muted small">Haz de nuevo el quiz o el V/F de la lección. Al acertar, el fallo se borra.</p>`;
  if (!keys.length) h += `<div class="empty">Sin fallos pendientes. 💪</div>`;
  for (const lk of keys) {
    const [cid, n] = lk.split("/"); const c = course(cid); if (!c) continue;
    const v = lessonsOf(c).find(x => x.n === +n) || { n: +n, t: "Lección " + n };
    h += lessonRow(c, v, by[lk] + " fallo" + (by[lk] > 1 ? "s" : "") + " · " + c.title);
  }
  V().innerHTML = h;
}

// ---------- Tutor ----------
function md(s) {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").split(/\n/);
  let out = "", list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const ln of lines) {
    const ul = ln.match(/^\s*[-*•]\s+(.*)/), ol = ln.match(/^\s*\d+[.)]\s+(.*)/), hd = ln.match(/^#{1,4}\s+(.*)/);
    if (ul || ol) { const t = ul ? "ul" : "ol"; if (list !== t) { close(); out += `<${t}>`; list = t; } out += `<li>${(ul || ol)[1]}</li>`; }
    else { close(); if (hd) out += `<p><b>${hd[1]}</b></p>`; else if (ln.trim()) out += `<p>${ln}</p>`; }
  }
  close(); return out;
}

async function shrink(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 1280 / Math.max(img.width, img.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", data: url.split(",")[1], url };
}

async function viewTutor(ctx) {
  const key = ctx ? LK(ctx.c.id, ctx.v.n) : "libre";
  const hist = TUT[key] = TUT[key] || [];
  let ctxText = "", img = null;
  const sugg = ctx ? ["Explícame esta clase en 5 puntos", "¿Qué es lo más importante para el examen?", "Hazme 3 preguntas difíciles", "Dame un ejemplo práctico en planta"]
    : ["¿Cómo funciona un contacto de enclavamiento?", "Diferencia entre PLC y relé", "Explícame un PID con un ejemplo", "Te mando la foto de un ejercicio"];
  V().innerHTML = `${ctx ? `<button class="back" onclick="go('#/leccion/${encodeURIComponent(ctx.c.id)}/${ctx.v.n}')">${ICON.back} Lección</button>` : ""}
    <h2 style="margin:8px 0 2px">${ctx ? "Tutor de la clase" : "Tu tutor"}</h2><p class="muted small" style="margin:0 0 14px">${ctx ? esc(ctx.v.t) : "Pregunta lo que quieras o mándale una foto de un problema."}</p>
    <div class="chat" id="chat"></div>
    <div class="composer"><div class="composer-in"><div class="grow"><div id="pv"></div><div class="row" style="gap:8px">
      <label class="icon-btn" aria-label="Foto">${ICON.cam}<input type="file" accept="image/*" id="file" hidden></label>
      <textarea id="msg" rows="1" placeholder="Escribe tu pregunta…"></textarea>
      <button class="icon-btn send" id="send" aria-label="Enviar">${ICON.send}</button></div></div></div></div>`;
  const chat = $("chat");
  const paint = () => {
    chat.innerHTML = hist.length ? hist.map(m => `<div class="msg ${m.role}">${m.img ? `<img src="data:${m.img.mime};base64,${m.img.data}" alt="">` : ""}${m.role === "model" ? md(m.text) : esc(m.text)}</div>`).join("")
      : `<div class="chips">${sugg.map(s => `<button class="chip">${esc(s)}</button>`).join("")}</div>`;
    chat.querySelectorAll(".chip").forEach(b => b.onclick = () => { if (/foto/.test(b.textContent)) $("file").click(); else { $("msg").value = b.textContent; send(); } });
    window.scrollTo(0, document.body.scrollHeight);
  };
  const ta = $("msg");
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(); } };
  $("file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { img = await shrink(f); $("pv").innerHTML = `<div class="preview-img"><img src="${img.url}" alt=""><button id="rmimg">×</button></div>`; $("rmimg").onclick = () => { img = null; $("pv").innerHTML = ""; }; }
    catch (_) { toast("No pude leer esa imagen."); }
    e.target.value = "";
  };
  let busy = false;
  async function send() {
    const text = ta.value.trim();
    if (busy || (!text && !img)) return;
    if (!IA.key) return needKey(ctx && ctx.c, ctx && ctx.v, "El tutor");
    busy = true;
    hist.push({ role: "user", text: text || "", img: img ? { mime: img.mime, data: img.data } : null });
    ta.value = ""; ta.style.height = ""; img = null; $("pv").innerHTML = "";
    paint(); chat.insertAdjacentHTML("beforeend", `<div class="typing" id="typing">El tutor está escribiendo…</div>`); window.scrollTo(0, document.body.scrollHeight);
    try {
      if (ctx && !ctxText) ctxText = (await Store.transcript(ctx.c.id, ctx.v.n)) || "";
      const ans = await IA.chat(hist.slice(-20), ctxText, ctx ? ctx.v.t : "");
      hist.push({ role: "model", text: ans }); act(1);
    } catch (e) { hist.pop(); toast(e.message, 4500); }
    busy = false; paint();
  }
  $("send").onclick = send;
  paint();
}

// ---------- Progress ----------
function viewProgreso() {
  const s = streak(), days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(today(), -i));
  const mins = days.map(d => dayTotal(d).m), max = Math.max(10, ...mins);
  const wd = d => new Date(d + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "").slice(0, 3);
  const all = Object.keys(P.dias).reduce((a, d) => a + dayTotal(d).m, 0);
  const cs = studyCourses();
  V().innerHTML = `<h1 style="margin:8px 0 14px">Progreso</h1>
    <div class="card hero"><div class="row"><div class="ic" style="color:var(--ac)">${ICON.flame}</div><h2>${s} día${s === 1 ? "" : "s"} de racha</h2></div>
    <div class="week section" style="margin-top:14px">${days.map(d => `<div>${wd(d)}<i class="${studied(d) ? "on" : ""}">${studied(d) ? "✔" : ""}</i></div>`).join("")}</div></div>
    <div class="card section"><div class="row between"><h3>Minutos de estudio</h3><span class="muted small">últimos 7 días · total ${all} min</span></div>
    <div class="chart">${days.map((d, i) => `<div><b>${mins[i] || ""}</b><i style="height:${Math.round(mins[i] * 100 / max)}%"></i>${wd(d)}</div>`).join("")}</div></div>
    <div class="section"><h2>Dominio por curso</h2>${cs.map(c => { const m = courseMastery(c); return `<a class="card tap" href="#/curso/${encodeURIComponent(c.id)}" style="display:block;margin-bottom:8px"><div class="row between"><b class="small">${esc(c.title)}</b><span class="small" style="color:var(--ac2)">${m}%</span></div><div class="bar" style="margin-top:8px"><i style="width:${m}%"></i></div></a>`; }).join("") || `<p class="muted">Aún no hay cursos.</p>`}</div>`;
}

// ---------- Settings ----------
function viewAjustes() {
  let email = ""; try { email = localStorage.getItem("gmail") || ""; } catch (_) { /* storage blocked */ }
  V().innerHTML = `<h1 style="margin:8px 0 14px">Ajustes</h1>
    <div class="card"><h3>Inteligencia artificial (Gemini)</h3>
    <p class="muted small">${IA.key ? "Conectada · modelo <b>" + esc(IA.model) + "</b>" : "Sin conectar. Es gratis con límite diario."}</p>
    <ol class="steps"><li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--ac2)">aistudio.google.com/apikey</a> con tu cuenta de Google.</li><li>Toca <b>Create API key</b> y cópiala.</li><li>Pégala aquí y guarda. Se guarda solo en tu Drive.</li></ol>
    <label class="f" for="gk">Clave de Gemini</label><input class="in" id="gk" type="password" autocomplete="off" placeholder="${IA.key ? "•••••••• (guardada)" : "AIza…"}">
    <div class="row" style="margin-top:10px"><button class="btn primary grow" id="gsave">Guardar y probar</button>${IA.key ? `<button class="btn ghost" id="gdel">Quitar</button>` : ""}</div></div>
    <div class="card section"><h3>Tus datos</h3><p class="muted small">Todo se guarda en tu Drive: <b>Mi unidad/Estudio/Repasa</b>. Los títulos de los cursos salen de Netflix PLC.${email ? "<br>Cuenta: " + esc(email) : ""}</p>
    <button class="btn block" id="fsync">Sincronizar ahora</button></div>
    <p class="muted small" style="text-align:center">Repasa · versión 2</p>`;
  $("gsave").onclick = async () => {
    const k = $("gk").value.trim(); if (!k) return toast("Pega tu clave primero.");
    $("gsave").disabled = true; $("gsave").textContent = "Probando…";
    IA.key = k; IA.model = await IA.pickModel();
    let note = "Listo: Gemini conectado";
    try { await IA.call({ contents: [{ role: "user", parts: [{ text: "Responde solo: ok" }] }] }); }
    catch (e) {
      // A bad key stops here. A busy or out-of-quota model still means the key is valid: save it.
      if (/clave/i.test(e.message)) { IA.key = CFG.gemini || ""; IA.model = CFG.modelo || ""; toast(e.message, 4500); $("gsave").disabled = false; $("gsave").textContent = "Guardar y probar"; return; }
      note = "Clave guardada. Gemini está ocupado ahora; Repasa reintenta solo cuando lo uses.";
    }
    CFG.gemini = k; CFG.modelo = IA.model;
    try { await Store.saveConfig(CFG); toast(note, 4500); } catch (e) { toast("Funciona, pero no se guardó en Drive: " + e.message, 4500); }
    viewAjustes();
  };
  if ($("gdel")) $("gdel").onclick = async () => { CFG.gemini = ""; IA.key = ""; await Store.saveConfig(CFG); viewAjustes(); };
  $("fsync").onclick = async () => { dirty = true; await flush(); toast("Sincronizado"); };
}

// ---------- Start ----------
async function start() {
  if (started) return;
  $("login").hidden = true;
  V().innerHTML = `<div class="spin"></div><p class="empty" style="padding-top:0">Cargando tus cursos…</p>`;
  try {
    await Store.init();
    const r = await Promise.all([Store.catalog(), Store.notebook(), Store.index(), Store.progress(), Store.config()]);
    CAT = r[0]; NB = r[1]; IDX = r[2]; P = r[3] ? merge(blank(), r[3]) : blank(); CFG = r[4] || {};
    IA.key = CFG.gemini || ""; IA.model = CFG.modelo || "gemini-2.5-flash";
    // When Gemini had to switch to another model, remember the one that answered.
    IA.onModel = m => { CFG.modelo = m; Store.saveConfig(CFG).catch(() => {}); };
    if (Drive.rememberEmail) Drive.rememberEmail();
    started = true; sync(""); route();
  } catch (e) {
    V().innerHTML = `<div class="empty"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Reintentar</button></div>`;
  }
}
function showLogin(msg) {
  $("login").hidden = false;
  let email = null; try { email = localStorage.getItem("gmail"); } catch (_) { /* storage blocked */ }
  if (email) $("blogin").textContent = "Continuar como " + email;
  $("lmsg").textContent = msg || "";
}
function boot() {
  const m = location.hash.match(/llavero=([\w+/=-]+)/);
  if (m) {
    try { const l = JSON.parse(atob(m[1])); if (l.u && l.k) localStorage.setItem("llavero", JSON.stringify(l)); } catch (_) { /* bad link */ }
    history.replaceState(null, "", location.pathname);
  }
  if (window.MOCK) return start();
  const go2 = () => {
    if (!window.google || !google.accounts) return showLogin("No cargó el inicio de sesión de Google. Revisa tu internet y recarga.");
    Drive.onToken = () => start();
    Drive.onExpired = () => { if (!started) showLogin("Tu sesión venció. Entra de nuevo."); else toast("Sesión vencida: toca para renovar", 4000); };
    if (Drive.init()) start();
    else if (Drive.llavero()) Drive.fromLlavero().then(ok => { if (!ok) showLogin("El llavero no respondió: entra con Google esta vez."); });
    else showLogin();
  };
  if (window.google && google.accounts) go2();
  else { window.gsiReady = go2; setTimeout(() => { if (!started && !(window.google && google.accounts)) go2(); }, 8000); }
}
$("blogin").onclick = () => Drive.login();
document.addEventListener("click", () => { if (!window.MOCK && Drive.client) Drive.renewOnTap(); });
if ("serviceWorker" in navigator && !window.MOCK) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
