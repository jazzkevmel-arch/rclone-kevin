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

// ---------- screens ----------
function setVisto(v) {
  const st = V(v);
  if (!st.visto) { st.visto = true; st.vf = today(); touch(v); exportDue = true; }
}
function renderStats() {
  const { dias } = totals(), list = ruta(), vistos = list.filter(x => V(x.v).visto).length;
  const acts = list.filter(x => x.v.k !== "V"), hechas = acts.filter(x => V(x.v).act).length;
  const min = Object.values(dias).reduce((a, b) => a + b, 0);
  let st = 0; const d = new Date();
  if (!(dias[today()] > 0)) d.setDate(d.getDate() - 1);
  while ((dias[d.toLocaleDateString("en-CA")] || 0) > 0) { st++; d.setDate(d.getDate() - 1); }
  $("stats").innerHTML = [
    [`${vistos}/${list.length}`, "mi ruta"], [`${hechas}/${acts.length}`, "actividades"],
    [`${Math.round(dias[today()] || 0)} min`, "hoy"], [`${st} ${st === 1 ? "día" : "días"}`, "racha"],
    [`${(min / 60).toFixed(1)} h`, "estudiadas"],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><small>${s}</small></div>`).join("");
}
function renderHero() {
  const list = all();
  let h = S.ultimo && list.find(x => K(x.v) === S.ultimo);
  if (!h || V(h.v).visto) h = nextsByCat()[0];
  const nx = nextsByCat().filter(x => !h || K(x.v) !== K(h.v));
  const pend = list.filter(x => V(x.v).visto && !V(x.v).act && x.v.k !== "V")
    .sort((a, b) => (V(b.v).vf || "").localeCompare(V(a.v).vf || "")).slice(0, 6);
  const st = h ? V(h.v) : null;
  const mm = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  $("hero").innerHTML = (h ? `<div>
      <div class="kicker">${st.pos > 5 ? "Continuar viendo en " + mm(st.pos) : "Siguiente"} · ${esc(h.c.cat)}</div>
      <h2>${h.v.n}. ${esc(h.v.t)}</h2>
      <div class="course">${esc(h.c.title)}${h.v.s ? " · " + esc(h.v.s) : ""}</div>
      ${st.dur ? `<div class="bar" style="margin-top:10px;max-width:320px"><i style="width:${Math.min(100, st.pos / st.dur * 100)}%"></i></div>` : ""}
      <button class="play" data-open="${h.ci},${h.vi}">▶ ${h.c.web ? "Abrir lección" : "Reproducir"}</button>
      ${nx.length ? `<div class="todo" style="margin-top:18px"><h3>También en tu ruta</h3><ul>${nx.map(x =>
        `<li data-open="${x.ci},${x.vi}">${esc(x.c.title)}: ${x.v.n}. ${esc(x.v.t)}</li>`).join("")}</ul></div>` : ""}</div>`
      : `<div><h2>Terminaste tu ruta</h2></div>`) +
    `<div class="todo"><h3>Actividades pendientes de lo que ya viste</h3>${pend.length ? "<ul>" + pend.map(x =>
      `<li data-open="${x.ci},${x.vi}"><span class="badge k-${x.v.k}">${TIPOS[x.v.k]}</span> ${esc(x.v.a)} <span class="small">(${esc(x.c.title)}, ${x.v.n})</span></li>`).join("") + "</ul>"
      : `<p class="small">Ninguna. Cada video que termines deja aquí su actividad hasta que la marques como hecha.</p>`}</div>`;
}
function renderFilters(el) {
  const f = [["ruta", "Mi ruta"], ...CATS.filter(c => C.some(x => x.cat === c)).map(c => [c, c]), ["todo", "Todo"]];
  $(el).innerHTML = f.map(([n, t]) => `<button class="chip ${filt === n ? "on" : ""}" data-filt="${esc(n)}">${esc(t)}</button>`).join("") +
    `<button class="chip ${soloPend ? "on" : ""}" data-pend="1">Solo pendientes</button>` +
    `<input class="search" data-search="${el}" placeholder="Buscar video o curso..." value="${esc(q)}">` +
    (el === "afilters" ? `<button class="chip" onclick="print()">Imprimir listado</button>` : "");
}
const show = c => filt === "todo" || (filt === "ruta" ? c.ruta : c.cat === filt);
function match(c, v) {
  if (!q) return true;
  const s = q.toLowerCase();
  return c.title.toLowerCase().includes(s) || v.t.toLowerCase().includes(s) || (v.s || "").toLowerCase().includes(s);
}
function card(c, ci, v, vi) {
  const st = V(v), pct = st.dur ? Math.min(100, st.pos / st.dur * 100) : 0;
  return `<div class="card ${st.visto ? "done" : ""}" data-open="${ci},${vi}" title="${esc(v.a)}">
    <div class="marks">${st.visto ? '<span class="ok">✔ visto</span>' : ""}${st.act ? ' <span class="ok">· act.</span>' : ""}</div>
    <div class="num">${v.n}</div>${v.s ? `<div class="sec">${esc(v.s)}</div>` : ""}<div class="t">${esc(v.t)}</div>
    <div><span class="badge k-${v.k}">${TIPOS[v.k]}</span></div>
    <div class="bar"><i style="width:${st.visto ? 100 : pct}%"></i></div></div>`;
}
function renderRows() {
  renderFilters("filters");
  let lastCat = "", html = "";
  C.forEach((c, ci) => {
    if (!show(c)) return;
    const done = c.videos.filter(v => V(v).visto).length, pct = Math.round(done / c.videos.length * 100);
    const vids = c.videos.map((v, vi) => (soloPend && V(v).visto) || !match(c, v) ? "" : card(c, ci, v, vi)).join("");
    if (!vids) return;
    if (c.cat !== lastCat) { html += `<h2 class="cat-h">${esc(c.cat)}</h2>`; lastCat = c.cat; }
    html += `<div class="row"><div class="row-head"><h3>${esc(c.title)}</h3>
      <span class="meta">${c.fase ? "Fase " + c.fase + " · " : ""}${done}/${c.videos.length} · ${pct}%</span>
      <div class="bar"><i style="width:${pct}%"></i></div></div><div class="cards">${vids}</div></div>`;
  });
  $("rows").innerHTML = html || `<p class="small">Nada con ese filtro.</p>`;
}
function renderActs() {
  renderFilters("afilters");
  let html = "";
  C.forEach((c, ci) => {
    if (!show(c)) return;
    const rows = c.videos.map((v, vi) => {
      const st = V(v);
      if ((soloPend && st.act) || !match(c, v)) return "";
      return `<tr class="${st.act ? "hecho" : ""}"><td class="c"><input type="checkbox" data-act="${ci},${vi}" ${st.act ? "checked" : ""}></td>
        <td>${v.n}</td><td><span class="badge k-${v.k}">${TIPOS[v.k]}</span></td><td>${esc(v.a)}</td>
        <td class="small" data-open="${ci},${vi}" style="cursor:pointer">${v.s ? esc(v.s) + " · " : ""}${esc(v.t)}${st.visto ? " ✔" : ""}</td></tr>`;
    }).join("");
    if (rows) html += `<h3>${esc(c.title)} <span class="small">${esc(c.cat)} · ${esc(c.tool)}</span></h3>
      <table><thead><tr><th></th><th>#</th><th>Tipo</th><th>Actividad</th><th>Video</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  $("alist").innerHTML = html || `<p class="small">Nada con ese filtro.</p>`;
}
function render() {
  if (!C.length) return;
  renderStats(); renderHero(); renderRows();
  if (!$("view-act").hidden) renderActs();
}

// ---------- player ----------
async function openVid(ci, vi) {
  const c = C[ci], v = c.videos[vi], vid = $("video"), web = !!c.web;
  cur = { ci, vi };
  $("ptitle").textContent = `${c.title} · ${v.n}. ${v.t}`;
  $("pbadge").className = "badge k-" + v.k; $("pbadge").textContent = TIPOS[v.k];
  $("pact").textContent = v.a; $("ptool").textContent = "Herramienta: " + c.tool;
  $("vmsg").style.display = "none"; $("mprev").dataset.armed = "";
  $("mprev").textContent = "Marcar anteriores como vistos";
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
  $("pdone").checked = st.act; $("pnote").value = st.nota || "";
  $("mvisto").textContent = st.visto ? "✔ Visto" : "Marcar como visto";
  if (web) { $("websec").textContent = v.s || c.title; $("weblink").href = v.url; return; }
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
$("pnote").oninput = e => { const v = curV(); V(v).nota = e.target.value; touch(v); save(3000); };
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
  const o = e.target.closest("[data-open]");
  if (o) { const [ci, vi] = o.dataset.open.split(",").map(Number); return openVid(ci, vi); }
  const f = e.target.closest("[data-filt]");
  if (f) { filt = f.dataset.filt; return render(); }
  if (e.target.closest("[data-pend]")) { soloPend = !soloPend; return render(); }
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
function tab(t) {
  $("view-ver").hidden = t !== "ver"; $("view-act").hidden = t !== "act";
  $("tab-ver").classList.toggle("on", t === "ver"); $("tab-act").classList.toggle("on", t === "act"); render();
}
$("tab-ver").onclick = () => tab("ver");
$("tab-act").onclick = () => tab("act");

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
}

let started = false;
async function start() {
  sendTokenToWorker().catch(() => {});
  sessionCheck();
  if (started) { flush(); return; }
  started = true;
  $("login").hidden = true; $("app").hidden = false;
  $("hero").innerHTML = `<div><h2>Cargando tus cursos desde Google Drive...</h2></div>`;
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
    await pull();
    render();
    syncMsg("✔ Al día");
  } catch (e) {
    started = false;
    $("hero").innerHTML = `<div><h2>No se pudo cargar</h2><p>${esc(e.message)}</p><button class="play" onclick="location.reload()">Reintentar</button></div>`;
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
