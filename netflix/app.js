// Netflix PLC, web version. Same app on the phone and the PC.
// Data lives in the user's Google Drive, folder "Mi unidad/Estudio/Netflix_PLC":
//   catalogo.json      courses, videos (with Drive file IDs) and activities. Made on the PC by generar_catalogo.py.
//   progreso.json      progress: position of each video to the second, watched, activities, notes, minutes.
//   avance_netflix.csv and dias_netflix.csv   read by the Excel habit tracker.
// And "Mi unidad/Estudio/netflix_plc_recordatorio.json", read by the WhatsApp bot Carli.
// Two devices can study on the same day: each video keeps the newest change, minutes are kept per device.
const REC_NAME = "netflix_plc_recordatorio.json";
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toLocaleDateString("en-CA");
const K = v => v.p || v.id;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
};
const DEV = store.get("device") || (() => { const d = "d" + Math.random().toString(36).slice(2, 8); store.set("device", d); return d; })();

let C = [], TIPOS = {}, CATS = [];
// cuestionarios.json (optional, same Drive folder): mini quizzes made with NotebookLM from each video's transcript.
//   { cursos: { <course id>: { cuaderno: <NotebookLM URL> } }, videos: { <video key>: [ { q, o: [options], c: <right index>, e: <why> } ] } }
let QZ = { cursos: {}, videos: {} };
const quizOf = v => QZ.videos[K(v)] || null;
const quizPass = n => Math.ceil(n * 0.8);
let S = { videos: {}, ultimo: null, uu: 0, md: {} };
let ids = {}, filt = "ruta", soloPend = false, q = "", cur = null, lastTick = null;
let saveT = null, busy = Promise.resolve(), dirty = false, exportDue = true, lastExport = 0;

const V = v => (S.videos[K(v)] ||= { pos: 0, dur: 0, visto: false, act: false, nota: "", u: 0 });
const touch = v => { V(v).u = Date.now(); };
const all = () => C.flatMap((c, ci) => c.videos.map((v, vi) => ({ c, ci, v, vi })));
const ruta = () => all().filter(x => x.c.ruta);

// ---------- minutes per day ----------
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

// ---------- sync with Drive ----------
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
  // Plan of the day: the newest day wins; on the same day both devices' items are kept.
  if (r.plan && (!S.plan || r.plan.fecha > S.plan.fecha)) S.plan = r.plan;
  else if (r.plan && r.plan.fecha === S.plan.fecha) {
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
async function pull() {
  if (!ids.prog) {
    const f = await Drive.find(ids.folder, "progreso.json");
    if (!f) return;
    ids.prog = f.id;
  }
  merge(JSON.parse((await Drive.read(ids.prog)) || "{}"));
}
function syncMsg(t) { $("sync").textContent = t; }
function queue(fn) { busy = busy.then(fn, fn); return busy; }
function save(ms = 15000) {
  dirty = true;
  if (saveT && ms >= 15000) return;          // during playback: at most one save every 15 s
  clearTimeout(saveT);
  saveT = setTimeout(flush, ms);
}
const saveNow = () => { exportDue = true; save(800); };
function flush() {
  clearTimeout(saveT); saveT = null;
  if (!dirty) return busy;
  return queue(async () => {
    if (!dirty) return;
    dirty = false;
    syncMsg("Guardando...");
    try {
      await pull();
      const body = JSON.stringify({ ...S, ...totals(), actualizado: new Date().toISOString() });
      const r = await Drive.write(ids.folder, "progreso.json", body, "application/json", ids.prog);
      ids.prog = r.id;
      if (exportDue || Date.now() - lastExport > 5 * 60000) await writeExports();
      syncMsg("✔ Guardado " + new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      dirty = true;
      syncMsg("Sin guardar: " + (navigator.onLine ? "se reintenta" : "sin internet"));
      if (!saveT) saveT = setTimeout(flush, 30000);
    }
  });
}

// ---------- files for Excel and the bot ----------
function localIso() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const csvCell = x => { x = String(x); return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
const csv = rows => "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
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
async function writeFile(key, parent, name, text, mime) {
  if (!ids[key]) { const f = await Drive.find(parent, name); if (f) ids[key] = f.id; }
  ids[key] = (await Drive.write(parent, name, text, mime, ids[key])).id;
}
async function writeExports() {
  const now = localIso(), { dias, diasCat } = totals();
  const av = [["categoria", "curso", "mi_ruta", "vistos", "total", "porcentaje", "actividades_hechas", "actividades_total", "siguiente", "actualizado"]];
  const pend = [];
  for (const c of C) {
    const seen = c.videos.filter(v => V(v).visto), acts = c.videos.filter(v => v.k !== "V");
    const nxt = c.videos.find(v => !V(v).visto);
    av.push([c.cat, c.title, c.ruta ? "Sí" : "No", seen.length, c.videos.length,
      c.videos.length ? Math.round(seen.length / c.videos.length * 10000) / 10000 : 0,
      acts.filter(v => V(v).act).length, acts.length, nxt ? `${nxt.n}. ${nxt.t}` : "Terminado", now]);
    for (const v of seen) if (v.k !== "V" && !V(v).act) pend.push({ vf: V(v).vf || "", c, v });
  }
  const count = {};
  for (const c of C) for (const v of c.videos) { const vf = V(v).vf; if (vf) count[vf + "\u0001" + c.cat] = (count[vf + "\u0001" + c.cat] || 0) + 1; }
  const keys = new Set(Object.keys(count));
  for (const [d, cats] of Object.entries(diasCat)) for (const c of Object.keys(cats)) keys.add(d + "\u0001" + c);
  const di = [["fecha", "categoria", "minutos", "vistos"]];
  for (const k of [...keys].sort()) {
    const [d, c] = k.split("\u0001");
    di.push([d, c, Math.round(((diasCat[d] || {})[c] || 0) * 10) / 10, count[k] || 0]);
  }
  let streak = 0; const d = new Date();
  if (!(dias[today()] > 0)) d.setDate(d.getDate() - 1);
  while ((dias[d.toLocaleDateString("en-CA")] || 0) > 0) { streak++; d.setDate(d.getDate() - 1); }
  const nexts = nextsByCat().map(({ c, v }) => {
    const it = { categoria: c.cat, curso: c.title, n: v.n, titulo: v.t, tipo: TIPOS[v.k], actividad: v.a };
    if (c.web) { it.url = v.url; it.seccion = v.s || ""; }
    return it;
  });
  pend.sort((a, b) => b.vf.localeCompare(a.vf));
  const rec = { actualizado: now, hoy_min: Math.round(dias[today()] || 0), racha_dias: streak, siguientes: nexts,
    pendientes: pend.slice(0, 5).map(({ c, v }) => ({ curso: c.title, n: v.n, titulo: v.t, tipo: TIPOS[v.k], actividad: v.a })) };
  const ep = nexts.find(x => x.categoria.startsWith("Diseño eléctrico"));
  if (ep) rec.eplan = { sesion: ep.seccion || "", leccion: ep.titulo, actividad: ep.actividad, url: ep.url || "" };
  await writeFile("avance", ids.folder, "avance_netflix.csv", csv(av), "text/csv");
  await writeFile("dias", ids.folder, "dias_netflix.csv", csv(di), "text/csv");
  await writeFile("rec", ids.estudio, REC_NAME, JSON.stringify(rec, null, 1), "application/json");
  exportDue = false; lastExport = Date.now();
}

// ---------- what to deliver for each activity ----------
const FOTO = {
  "Automatización y PLC": "1 captura de tu programa funcionando en la VM (simulación o PLCSIM).",
  "Diseño eléctrico (EPLAN)": "1 captura de EPLAN donde se vea lo que hiciste en tu proyecto 'Tablero CCM de práctica'.",
  "Celulares": "1 foto del equipo, la pieza o la medición (multímetro, placa).",
  "Electrónica": "1 foto del circuito o de la medición.",
  "Computadoras, laptops y TV": "1 foto del equipo o de la prueba que hiciste.",
  "Diseño CAD": "1 captura del dibujo o la pieza terminada.",
  "Programación y datos": "1 captura del código y de su resultado.",
};
const lower1 = s => s.charAt(0).toLowerCase() + s.slice(1);
function entrega(c, v) {
  if (v.k === "V") return { txt: "Nada. Solo mira el video: se marca solo al llegar al 90 %.", foto: false, nota: false };
  if (v.k === "T" && quizOf(v)) {
    const n = quizOf(v).length;
    return { txt: `El mini cuestionario de abajo (${quizPass(n)} de ${n} bien) o tu respuesta en «Mis notas» (2 a 5 líneas). Con cualquiera de los dos, la actividad queda hecha.`, foto: false, nota: true, quiz: true };
  }
  if (v.k === "T" || c.cat === "Idiomas")
    return { txt: "Tu respuesta escrita en «Mis notas» (2 a 5 líneas). Al escribirla, la actividad queda hecha.", foto: false, nota: true };
  const foto = FOTO[c.cat] || "1 captura o foto del resultado.";
  if (v.k === "R")
    return { txt: "Haz el reto antes de ver la solución. Sube " + lower1(foto) +
      " En «Mis notas»: qué te salió solo y qué tuviste que ver en el video.", foto: true, nota: true };
  return { txt: "Sube " + lower1(foto) + " Con eso la actividad queda hecha.", foto: true, nota: false };
}
// The activity is done by itself when its deliverable is there.
function autoDone(c, v) {
  const st = V(v), e = entrega(c, v);
  if (v.k === "V" || st.act) return false;
  const notaOk = (st.nota || "").trim().length >= 30, fotoOk = (st.ev || []).length > 0;
  const quizOk = e.quiz && st.qz && st.qz.ok >= quizPass(st.qz.n);
  if (quizOk || ((!e.foto || fotoOk) && (!e.nota || notaOk))) { st.act = true; touch(v); exportDue = true; return true; }
  return false;
}

// ---------- screens ----------
let view = "hoy", expFilt = "ruta", expCourse = null, IDX = new Map();
const mm = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
function setVisto(v) {
  const st = V(v);
  if (!st.visto) { st.visto = true; st.vf = today(); touch(v); exportDue = true; }
}
function streakOf(dias) {
  let st = 0; const d = new Date();
  if (!(dias[today()] > 0)) d.setDate(d.getDate() - 1);
  while ((dias[d.toLocaleDateString("en-CA")] || 0) > 0) { st++; d.setDate(d.getDate() - 1); }
  return st;
}
// Today's plan: the next video of each "Mi ruta" category, fixed for the whole day.
function planHoy() {
  if (!S.plan || S.plan.fecha !== today()) {
    S.plan = { fecha: today(), items: nextsByCat().map(x => K(x.v)), u: Date.now() };
    save(1500);
  }
  return S.plan;
}
function nextInCat(cat) {
  const inPlan = new Set(S.plan.items);
  return all().find(x => x.c.ruta && x.c.cat === cat && !V(x.v).visto && !inPlan.has(K(x.v)));
}
function renderMenu() {
  const opts = [["ruta", "Mi ruta", C.filter(c => c.ruta).length],
    ...CATS.map(c => [c, c, C.filter(x => x.cat === c).length]).filter(o => o[2]), ["todo", "Todo", C.length]];
  $("expmenu").innerHTML = opts.map(([k, t, n]) =>
    `<button data-exp="${esc(k)}" class="${view === "exp" && expFilt === k ? "on" : ""}">${esc(t)} <small>${n} ${n === 1 ? "curso" : "cursos"}</small></button>`).join("");
}
const show = (c, f) => f === "todo" || (f === "ruta" ? c.ruta : c.cat === f);
function match(c, v) {
  if (!q) return true;
  const s = q.toLowerCase();
  return c.title.toLowerCase().includes(s) || v.t.toLowerCase().includes(s) || (v.s || "").toLowerCase().includes(s);
}
// ---------- streaming look ----------
// Colors stay between teal and violet (no reds).
const hue = c => { let h = 0; for (const ch of c.id + c.cat) h = (h * 31 + ch.charCodeAt(0)) % 997; return 160 + h % 130; };
const short = t => t.replace(/\s*\(.*?\)\s*/g, " ").trim();
function tile(x) {
  const st = V(x.v), pct = st.visto ? 100 : st.dur ? Math.min(100, st.pos / st.dur * 100) : 0;
  return `<div class="tile" data-open="${x.ci},${x.vi}" title="${esc(x.v.a)}">
    <div class="art" style="--h:${hue(x.c)}"><span class="ct">${esc(short(x.c.title))}</span>
      <span class="tt2">${esc(x.v.t)}</span><span class="ep">${x.v.n}</span>${st.visto ? '<span class="okm">✔ VISTO</span>' : ""}<span class="pl">▶</span></div>
    ${pct > 1 ? `<div class="pb"><i style="width:${pct}%"></i></div>` : ""}
    <div class="cap"><span class="badge k-${x.v.k}">${TIPOS[x.v.k]}</span>${x.v.s ? esc(x.v.s).slice(0, 40) : ""}${st.act ? " · ✔ entregada" : ""}</div></div>`;
}
function row(title, items, extra = "", sub = "") {
  if (!items.length) return "";
  return `<section class="rowx"><h3>${esc(title)}${sub ? ` <small>${esc(sub)}</small>` : ""}${extra}</h3><div class="track">${items.map(tile).join("")}</div></section>`;
}
// Videos of a course for its row: start a little before the first pending one.
function courseRow(c, ci, n = 24) {
  const first = Math.max(0, c.videos.findIndex(v => !V(v).visto));
  const from = Math.max(0, first - 2), done = c.videos.filter(v => V(v).visto).length;
  const items = c.videos.slice(from, from + n).map((v, k) => ({ c, ci, v, vi: from + k }));
  return row(c.title, items, ` <a data-course="${ci}">Ver todo ›</a>`, `${done}/${c.videos.length}`);
}

function renderHoy() {
  const p = planHoy(), { dias } = totals();
  const items = p.items.map(k => IDX.get(k)).filter(Boolean);
  const hechos = items.filter(x => V(x.v).visto).length, list = ruta();
  const pend = all().filter(x => V(x.v).visto && !V(x.v).act && x.v.k !== "V")
    .sort((a, b) => (V(b.v).vf || "").localeCompare(V(a.v).vf || "")).slice(0, 10);
  const seguir = all().filter(x => !V(x.v).visto && V(x.v).pos > 5).sort((a, b) => (V(b.v).u || 0) - (V(a.v).u || 0)).slice(0, 12);
  const st = streakOf(dias), cats = [...new Set(list.map(x => x.c.cat))].filter(nextInCat);
  // Billboard: the video in progress, else the first pending item of today's plan.
  let h = S.ultimo && IDX.get(S.ultimo);
  if (!h || V(h.v).visto) h = items.find(x => !V(x.v).visto) || null;
  let bill = "";
  if (h) {
    const hs = V(h.v), e = entrega(h.c, h.v);
    const play = h.c.web ? "↗ Abrir lección" : hs.pos > 5 ? "▶ Seguir en " + mm(hs.pos) : "▶ Reproducir";
    bill = `<section class="bill"><div class="bg" style="--h:${hue(h.c)}" data-n="${h.v.n}"></div><div class="fade"></div><div class="in">
      <div class="kicker">${hs.pos > 5 ? "Continuar viendo" : "Siguiente en tu plan"} · ${esc(h.c.cat)}</div>
      <h1>${esc(h.v.t)}</h1>
      <div class="meta">${esc(h.c.title)} · Episodio ${h.v.n}${h.v.s ? " · " + esc(h.v.s) : ""}</div>
      ${hs.dur ? `<div class="bar"><i style="width:${Math.min(100, hs.pos / hs.dur * 100)}%"></i></div>` : ""}
      ${h.v.k !== "V" ? `<p class="desc"><span class="badge k-${h.v.k}">${TIPOS[h.v.k]}</span> ${esc(h.v.a)}<br><span class="small">Entregas: ${esc(e.txt)}</span></p>` : ""}
      <button class="bbtn w" data-open="${h.ci},${h.vi}">${play}</button><button class="bbtn g" data-course="${h.ci}">ⓘ Ver curso</button>
      <div class="chips2">${[[`${hechos}/${items.length}`, "plan de hoy"], [`${Math.round(dias[today()] || 0)} min`, "hoy"],
        [`${st} ${st === 1 ? "día" : "días"}`, "racha"], [`${list.filter(x => V(x.v).visto).length}/${list.length}`, "mi ruta"]]
        .map(([b, s]) => `<div><b>${b}</b><small>${s}</small></div>`).join("")}</div></div></section>`;
  } else {
    bill = `<section class="bill"><div class="bg" style="--h:160" data-n="✔"></div><div class="fade"></div><div class="in">
      <div class="kicker">${hechos ? "Plan de hoy completo" : "Mi ruta"}</div><h1>${hechos ? "✔ Listo por hoy" : "Terminaste tu ruta"}</h1>
      <p class="desc">Si quieres seguir, agrega uno más a tu plan:</p>
      ${cats.map(c => `<button class="bbtn g" data-mas="${esc(c)}">+ ${esc(c)}</button>`).join("")}</div></section>`;
  }
  $("view-hoy").innerHTML = bill +
    row("Tu plan de hoy", items, "", `${hechos} de ${items.length} vistos`) +
    row("Continuar viendo", seguir.filter(x => !items.includes(x))) +
    row("Actividades por entregar", pend, "", "toca uno y sube tu captura o escribe tu respuesta") +
    `<p class="small" style="margin:10px 4%">Para ver otros cursos usa <b>Explorar ▾</b> arriba.</p>`;
}

function renderExp() {
  const name = expFilt === "ruta" ? "Mi ruta" : expFilt === "todo" ? "Todos los cursos" : expFilt;
  let html = "";
  if (expCourse !== null) {
    const c = C[expCourse], done = c.videos.filter(v => V(v).visto).length;
    const nx = c.videos.findIndex(v => !V(v).visto);
    html = `<div class="series"><div class="bg" style="--h:${hue(c)}"></div>
      <button class="back" data-back>◀ ${esc(name)}</button>
      <div class="kicker">${esc(c.cat)}</div><h2>${esc(c.title)}</h2>
      <div class="small">${done} de ${c.videos.length} vistos · ${esc(c.tool)}</div>
      <div class="bar" style="margin:10px 0 0;max-width:420px"><i style="width:${done / c.videos.length * 100}%"></i></div>
      ${nx >= 0 ? `<button class="bbtn w" data-open="${expCourse},${nx}">▶ ${V(c.videos[nx]).pos > 5 ? "Seguir" : done ? "Continuar" : "Empezar"}: episodio ${c.videos[nx].n}</button>` : ""}
      <button class="bbtn g" data-pend="1">${soloPend ? "Ver todos" : "Solo pendientes"}</button></div>
      <div class="vlist eps">`;
    let sec = null;
    c.videos.forEach((v, vi) => {
      if (soloPend && V(v).visto) return;
      if ((v.s || "") !== sec) { sec = v.s || ""; if (sec) html += `<div class="vsec">${esc(sec)}</div>`; }
      const st = V(v), pct = st.visto ? 100 : st.dur ? st.pos / st.dur * 100 : 0;
      html += `<div class="vrowi ${st.visto ? "ok" : ""}" data-open="${expCourse},${vi}"><span class="n">${st.visto ? "✔" : v.n}</span>
        <div><div class="art" style="--h:${hue(c)}"><span class="ep">${v.n}</span><span class="pl">▶</span></div>${pct > 1 ? `<div class="pb" style="height:3px;background:#333"><i style="display:block;height:100%;width:${pct}%;background:var(--accent)"></i></div>` : ""}</div>
        <div><div style="font-weight:600">${esc(v.t)}</div><div class="small">${TIPOS[v.k]}${st.act ? " · ✔ entregada" : ""}${!st.visto && st.pos > 5 ? " · vas en " + mm(st.pos) : ""}</div>
        ${v.k !== "V" ? `<div class="small" style="margin-top:4px;color:#c6cad2">${esc(v.a)}</div>` : ""}</div></div>`;
    });
    html += "</div>";
    $("view-exp").innerHTML = html;
    return;
  }
  html = `<div class="exph"><h2 style="margin:0">${esc(name)}</h2>
    <input class="search" data-search="exp" placeholder="Buscar video o curso..." value="${esc(q)}"></div>`;
  if (q) {
    const hits = all().filter(x => show(x.c, expFilt) && match(x.c, x.v)).slice(0, 60);
    html += hits.length ? row(`Resultados para «${q}»`, hits) : '<p class="small" style="margin:0 4%">Nada con esa búsqueda.</p>';
  } else {
    let lastCat = "";
    C.forEach((c, ci) => {
      if (!show(c, expFilt)) return;
      if (expFilt === "todo" && c.cat !== lastCat) { lastCat = c.cat; html += `<div class="sec-h" style="margin:26px 4% 0">${esc(c.cat)}</div>`; }
      html += courseRow(c, ci, expFilt === "todo" ? 14 : 24);
    });
  }
  $("view-exp").innerHTML = html;
}

function renderActs() {
  const f = [["ruta", "Mi ruta"], ...CATS.filter(c => C.some(x => x.cat === c)).map(c => [c, c]), ["todo", "Todo"]];
  $("afilters").innerHTML = f.map(([n, t]) => `<button class="chip ${filt === n ? "on" : ""}" data-filt="${esc(n)}">${esc(t)}</button>`).join("") +
    `<button class="chip ${soloPend ? "on" : ""}" data-pend="1">Solo pendientes</button>` +
    `<input class="search" data-search="act" placeholder="Buscar..." value="${esc(q)}">` +
    `<button class="chip" onclick="print()">Imprimir</button>`;
  let html = "";
  C.forEach((c, ci) => {
    if (!show(c, filt)) return;
    const rows = c.videos.map((v, vi) => {
      const st = V(v);
      if (v.k === "V" || (soloPend && st.act) || !match(c, v)) return "";
      return `<tr class="${st.act ? "hecho" : ""}"><td class="c"><input type="checkbox" data-act="${ci},${vi}" ${st.act ? "checked" : ""}></td>
        <td>${v.n}</td><td><span class="badge k-${v.k}">${TIPOS[v.k]}</span></td><td>${esc(v.a)}<div class="small">Entregas: ${esc(entrega(c, v).txt)}</div></td>
        <td class="small" data-open="${ci},${vi}" style="cursor:pointer">${v.s ? esc(v.s) + " · " : ""}${esc(v.t)}${st.visto ? " ✔" : ""}</td></tr>`;
    }).join("");
    if (rows) html += `<h3>${esc(c.title)} <span class="small">${esc(c.cat)}</span></h3>
      <table><thead><tr><th></th><th>#</th><th>Tipo</th><th>Actividad y entrega</th><th>Video</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  $("alist").innerHTML = html || '<p class="small">Nada con ese filtro.</p>';
}
function render() {
  if (!C.length) return;
  for (const t of ["hoy", "exp", "act"]) { $("view-" + t).hidden = view !== t; $("tab-" + t).classList.toggle("on", view === t); }
  renderMenu();
  if (view === "hoy") renderHoy(); else if (view === "exp") renderExp(); else renderActs();
}
function go(v) { view = v; q = ""; soloPend = false; $("expmenu").hidden = true; render(); scrollTo(0, 0); }

// ---------- player ----------
function renderSide(c, v) {
  const st = V(v), e = entrega(c, v);
  $("pentrega").innerHTML = `<b>Qué entregas</b>${esc(e.txt)}`;
  $("pevbox").style.display = e.foto ? "" : "none";
  $("pevs").innerHTML = (st.ev || []).map((f, i) =>
    `<a href="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view" target="_blank" rel="noopener">📷 Captura ${i + 1}</a>`).join("");
  $("pdone").checked = st.act;
  renderQuiz(c, v);
}
// ---------- mini quiz ----------
function renderQuiz(c, v) {
  const qs = quizOf(v), nb = (QZ.cursos[c.id] || {}).cuaderno, st = V(v);
  if (!qs) { $("pquiz").innerHTML = ""; return; }
  const best = st.qz ? `<p class="small">Tu mejor resultado: ${st.qz.ok} de ${st.qz.n} (${esc(st.qz.f)}).</p>` : "";
  $("pquiz").innerHTML = `<h4>Mini cuestionario</h4>${best}` +
    qs.map((x, i) => `<div class="qz" data-q="${i}"><p>${i + 1}. ${esc(x.q)}</p>` +
      x.o.map((o, j) => `<label><input type="radio" name="qz${i}" value="${j}"><span>${esc(o)}</span></label>`).join("") +
      `<div class="why small" hidden></div></div>`).join("") +
    `<button class="btn main" data-qcheck>Revisar respuestas</button><div class="qres" id="qres"></div>` +
    (nb ? `<p class="small">¿Dudas? <a href="${esc(nb)}" target="_blank" rel="noopener">Pregúntale al curso en NotebookLM ↗</a></p>` : "");
}
function checkQuiz() {
  if (!cur) return;
  const c = C[cur.ci], v = curV(), qs = quizOf(v), st = V(v);
  let ok = 0, answered = 0;
  qs.forEach((x, i) => {
    const box = document.querySelector(`.qz[data-q="${i}"]`), pick = box.querySelector("input:checked"), why = box.querySelector(".why");
    if (pick) answered++;
    const right = pick && +pick.value === x.c;
    if (right) ok++;
    box.querySelectorAll("label").forEach((l, j) => { l.className = j === x.c ? "ok" : pick && +pick.value === j ? "bad" : ""; });
    why.hidden = false;
    why.innerHTML = (right ? "✔ Correcto. " : "✘ Respuesta: " + esc(x.o[x.c]) + ". ") + esc(x.e || "");
  });
  if (answered < qs.length) { $("qres").textContent = `Te faltan ${qs.length - answered} preguntas.`; return; }
  const pass = quizPass(qs.length);
  if (!st.qz || ok >= st.qz.ok) st.qz = { ok, n: qs.length, f: today() };
  touch(v);
  const done = autoDone(c, v);
  if (done) $("pdone").checked = true;
  $("qres").textContent = `${ok} de ${qs.length} bien. ` + (ok >= pass ? (entrega(c, v).quiz ? "✔ Actividad hecha." : "✔ Bien.") : `Necesitas ${pass}: repasa el video y vuelve a intentar.`);
  saveNow();
}
document.addEventListener("click", e => { if (e.target.closest("[data-qcheck]")) checkQuiz(); });
async function loadQuiz() {
  try {
    const f = await Drive.find(ids.folder, "cuestionarios.json");
    if (f) QZ = { cursos: {}, videos: {}, ...JSON.parse(await Drive.read(f.id)) };
  } catch (_) { /* no quizzes: the app works the same */ }
}
async function addEvidence(files) {
  if (!cur) return;
  const c = C[cur.ci], v = curV(), st = V(v);
  $("pevmsg").textContent = "Subiendo...";
  try {
    if (!ids.ev) ids.ev = await Drive.folder(ids.folder, "evidencias");
    for (const f of files) {
      const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const name = `${c.title} - ${v.n}. ${v.t}`.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) + " - " + localIso().replace(/:/g, "-") + "." + ext;
      const r = await Drive.upload(ids.ev, name, f);
      (st.ev ||= []).push({ id: r.id, name });
    }
    touch(v); autoDone(c, v); saveNow(); renderSide(c, v);
    $("pevmsg").textContent = "✔ Subida a tu Drive (Netflix_PLC/evidencias).";
  } catch (err) {
    $("pevmsg").textContent = "No se pudo subir: " + err.message;
  }
}
async function openVid(ci, vi) {
  const c = C[ci], v = c.videos[vi], vid = $("video"), web = !!c.web;
  cur = { ci, vi };
  $("expmenu").hidden = true;
  $("ptitle").textContent = `${c.title} · ${v.n}. ${v.t}`;
  $("pbadge").className = "badge k-" + v.k; $("pbadge").textContent = TIPOS[v.k];
  $("pact").textContent = v.a; $("ptool").textContent = "Herramienta: " + c.tool;
  $("vmsg").style.display = "none"; $("mprev").dataset.armed = "";
  $("mprev").textContent = "Marcar anteriores como vistos";
  $("pevmsg").textContent = "En la PC también puedes pegar una captura aquí con Ctrl+V (Win+Shift+S para recortar la pantalla).";
  $("vbox").style.display = web ? "none" : "";
  $("webbox").style.display = web ? "flex" : "none";
  $("player").classList.add("open");
  document.body.style.overflow = "hidden";
  vid.pause(); vid.removeAttribute("src"); vid.load(); Zoom.reset();
  if (!web) $("vwait").style.display = "flex";
  // Get the newest position saved from the other device before resuming.
  await Promise.race([queue(pull).catch(() => {}), new Promise(r => setTimeout(r, 4000))]);
  if (!cur || cur.ci !== ci || cur.vi !== vi) return;
  const st = V(v);
  S.ultimo = K(v); S.uu = Date.now(); save(1500);
  $("pnote").value = st.nota || "";
  renderSide(c, v);
  $("mvisto").textContent = st.visto ? "✔ Visto" : "Marcar como visto";
  if (web) { $("websec").textContent = (v.s ? v.s + " · " : "") + v.t; $("weblink").href = v.url; return; }
  vid.src = "v/" + v.d;
  vid.onloadedmetadata = () => {
    $("vwait").style.display = "none";
    if (st.pos > 5 && st.pos < vid.duration - 15) vid.currentTime = st.pos;
    vid.play().catch(() => {});
    Zoom.showBar();
  };
}
function closeVid() {
  const vid = $("video");
  vid.pause(); vid.removeAttribute("src"); vid.load(); $("vwait").style.display = "none";
  Zoom.exitFull(); Zoom.reset();
  $("player").classList.remove("open"); document.body.style.overflow = ""; cur = null; lastTick = null;
  exportDue = true; flush(); render();
}
function step(d) {
  if (!cur) return;
  let { ci, vi } = cur; vi += d;
  if (vi < 0) { if (ci === 0) return; ci--; vi = C[ci].videos.length - 1; }
  if (vi >= C[ci].videos.length) { if (ci === C.length - 1) return; ci++; vi = 0; }
  flush(); openVid(ci, vi);
}
const curV = () => C[cur.ci].videos[cur.vi];
$("video").addEventListener("timeupdate", e => {
  if (!cur || C[cur.ci].web) return;
  const vid = e.target, c = C[cur.ci], v = curV(), st = V(v), now = performance.now();
  if (!vid.paused && lastTick) addMin(c.cat, Math.min(5, (now - lastTick) / 60000));
  lastTick = vid.paused ? null : now;
  st.pos = vid.currentTime; st.dur = vid.duration || st.dur; touch(v);
  if (st.dur && st.pos / st.dur >= 0.9 && !st.visto) { setVisto(v); $("mvisto").textContent = "✔ Visto"; saveNow(); }
  save();
});
$("video").addEventListener("pause", () => { lastTick = null; if (cur) save(1500); });
$("video").addEventListener("ended", () => { if (!cur) return; setVisto(curV()); saveNow(); $("next").focus(); });
$("video").addEventListener("error", () => {
  if ($("video").getAttribute("src")) { $("vmsg").style.display = "block"; $("vwait").style.display = "none"; }
});
$("pclose").onclick = closeVid;
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("pdone").onchange = e => { const v = curV(); V(v).act = e.target.checked; touch(v); saveNow(); };
$("pnote").oninput = e => {
  const c = C[cur.ci], v = curV(); V(v).nota = e.target.value; touch(v);
  if (autoDone(c, v)) { $("pdone").checked = true; saveNow(); } else save(3000);
};
$("pfile").onchange = e => { if (e.target.files.length) addEvidence([...e.target.files]); e.target.value = ""; };
document.addEventListener("paste", e => {
  if (!cur || $("pevbox").style.display === "none") return;
  const imgs = [...((e.clipboardData && e.clipboardData.items) || [])].filter(i => i.type.startsWith("image/")).map(i => i.getAsFile());
  if (imgs.length) { e.preventDefault(); addEvidence(imgs); }
});
$("mvisto").onclick = () => { setVisto(curV()); saveNow(); $("mvisto").textContent = "✔ Visto"; };
$("mprev").onclick = e => {
  const b = e.target;
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "¿Seguro? Toca otra vez para confirmar"; return; }
  C[cur.ci].videos.slice(0, cur.vi).forEach(setVisto);
  saveNow();
  b.dataset.armed = ""; b.textContent = `✔ ${cur.vi} marcados`;
};
document.addEventListener("keydown", e => { if (e.key === "Escape" && cur && !document.fullscreenElement) closeVid(); });
document.addEventListener("click", e => {
  const t = e.target;
  if (!t.closest(".dd")) $("expmenu").hidden = true;
  const o = t.closest("[data-open]");
  if (o) { const [ci, vi] = o.dataset.open.split(",").map(Number); return openVid(ci, vi); }
  const ex = t.closest("[data-exp]");
  if (ex) { expFilt = ex.dataset.exp; expCourse = null; return go("exp"); }
  const co = t.closest("[data-course]");
  if (co) { expCourse = +co.dataset.course; soloPend = false; render(); return scrollTo(0, 0); }
  if (t.closest("[data-back]")) { expCourse = null; return render(); }
  const mas = t.closest("[data-mas]");
  if (mas) { const x = nextInCat(mas.dataset.mas); if (x) { S.plan.items.push(K(x.v)); S.plan.u = Date.now(); saveNow(); render(); } return; }
  const f = t.closest("[data-filt]");
  if (f) { filt = f.dataset.filt; return render(); }
  if (t.closest("[data-pend]")) { soloPend = !soloPend; return render(); }
});
let searchT = null;
document.addEventListener("input", e => {
  const where = e.target.dataset.search;
  if (!where) return;
  q = e.target.value;
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    render();
    const box = document.querySelector(`[data-search="${where}"]`);
    if (box) { box.focus(); box.setSelectionRange(q.length, q.length); }
  }, 350);
});
document.addEventListener("change", e => {
  const a = e.target.dataset.act; if (!a) return;
  const [ci, vi] = a.split(",").map(Number), v = C[ci].videos[vi];
  V(v).act = e.target.checked; touch(v); saveNow(); render();
});
$("tab-hoy").onclick = () => go("hoy");
$("tab-act").onclick = () => { filt = "ruta"; go("act"); };
$("tab-exp").onclick = () => { renderMenu(); $("expmenu").hidden = !$("expmenu").hidden; };

// Save when the app goes to the background; refresh when it comes back.
document.addEventListener("visibilitychange", () => {
  if (!C.length) return;
  if (document.hidden) { exportDue = true; flush(); }
  else if (!cur) queue(pull).then(render).catch(() => {});
});
addEventListener("pagehide", () => { if (C.length) flush(); });

// ---------- Google session ----------
function warn(html) { $("warn").innerHTML = html; $("warn").style.display = html ? "block" : "none"; }
function sessionCheck() {
  if (!C.length) return;
  const m = Drive.minutesLeft();
  if (!Drive.valid()) warn(`Tu sesión de Google venció. <button class="btn main" data-renew>Volver a entrar</button>`);
  else if (m <= 8) warn(`Tu sesión de Google vence en ${m} min. <button class="btn main" data-renew>Renovar ahora</button>`);
  else warn("");
}
document.addEventListener("click", e => { if (e.target.closest("[data-renew]")) Drive.login(); });
setInterval(sessionCheck, 30000);

async function sendTokenToWorker() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  (navigator.serviceWorker.controller || reg.active).postMessage({ token: Drive.token });
}
async function startWorker() {
  if (!("serviceWorker" in navigator)) { warn("Este navegador no puede reproducir los videos de Drive. Usa Chrome."); return; }
  await navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data && e.data.needToken && e.ports[0]) e.ports[0].postMessage({ token: Drive.valid() ? Drive.token : null });
    if (e.data && e.data.expired) sessionCheck();
  });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise(r => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 3000); });
  }
}

async function loadCatalog() {
  const f = await Drive.find(ids.folder, "catalogo.json");
  if (!f) throw new Error("No encuentro catalogo.json en Mi unidad/Estudio/Netflix_PLC.");
  // Keep a copy on the device; download again only when the file in Drive changes.
  const key = "./_catalogo?" + encodeURIComponent(f.modifiedTime);
  let cache = null;
  try { cache = await caches.open("catalogo"); } catch (_) { /* no cache storage */ }
  let text = cache && await cache.match(key).then(r => r && r.text());
  if (!text) {
    text = await Drive.read(f.id);
    if (cache) { for (const k of await cache.keys()) await cache.delete(k); await cache.put(key, new Response(text)); }
  }
  const cat = JSON.parse(text);
  C = cat.cursos; TIPOS = cat.tipos; CATS = cat.cats;
  IDX = new Map(all().map(x => [K(x.v), x]));
}

let started = false;
async function start() {
  sendTokenToWorker().catch(() => {});
  sessionCheck();
  if (started) { flush(); return; }
  started = true;
  $("login").hidden = true; $("app").hidden = false;
  $("view-hoy").innerHTML = `<div class="wrap"><h2>Cargando tus cursos desde Google Drive...</h2></div>`;
  try {
    await startWorker();
    await sendTokenToWorker();
    const est = await Drive.find("root", "Estudio", true);
    if (!est) throw new Error("No encuentro la carpeta Estudio en tu Mi unidad.");
    ids.estudio = est.id;
    const fol = await Drive.find(ids.estudio, "Netflix_PLC", true);
    if (!fol) throw new Error("No encuentro la carpeta Mi unidad/Estudio/Netflix_PLC.");
    ids.folder = fol.id;
    await loadCatalog();
    await loadQuiz();
    await pull();
    render();
    syncMsg("✔ Al día");
  } catch (e) {
    started = false;
    $("view-hoy").innerHTML = `<div class="wrap"><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><button class="play" onclick="location.reload()">Reintentar</button></div>`;
  }
}

function boot() {
  if (!window.google || !google.accounts) { $("login").hidden = false; $("lmsg").textContent = "No cargó el inicio de sesión de Google. Revisa tu internet y recarga."; return; }
  Drive.onToken = start;
  Drive.onExpired = sessionCheck;
  if (Drive.init()) start();
  else $("login").hidden = false;
}
$("blogin").onclick = () => Drive.login();
boot();
