// Player controls with zoom, made for reading PLC programs on a small phone screen.
// Phone: pinch to zoom, double tap to zoom in at that spot (or back to 1x), drag to move, tap to show the controls.
// PC: mouse wheel to zoom, drag to move, click to play or pause, keys + − 0 F C < >, space and arrows.
// Both: press and hold the video to watch at 2x while holding; ⚙ menu for any speed and subtitle style.
const Zoom = (() => {
  const box = document.getElementById("vbox"), vid = document.getElementById("video");
  const $ = id => document.getElementById(id);
  const MAX = 6, SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let z = 1, tx = 0, ty = 0, hideT = null, tapT = null, lastTap = 0, seeking = false;
  const pts = new Map();
  let pinch = null, drag = null, moved = false, downAt = 0, holdT = null, held = null;
  const menuOpen = () => !$("vmenu").hidden;
  function endHold() {
    clearTimeout(holdT);
    if (held === null) return false;
    vid.playbackRate = held; held = null; $("fast").hidden = true;
    return true;
  }

  const size = () => ({ w: box.clientWidth, h: box.clientHeight });
  function apply() {
    const { w, h } = size();
    tx = Math.min(0, Math.max(w * (1 - z), tx));
    ty = Math.min(0, Math.max(h * (1 - z), ty));
    vid.style.transform = z === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${z})`;
    box.classList.toggle("zoomed", z > 1.01);
    $("zlabel").hidden = z <= 1.01;
    $("zlabel").textContent = "Zoom " + z.toFixed(1) + "x";
    $("zreset").classList.toggle("on", z > 1.01);
    const mb = $("minibox").style;
    mb.left = (-tx / (w * z) * 100) + "%"; mb.top = (-ty / (h * z) * 100) + "%";
    mb.width = mb.height = (100 / z) + "%";
  }
  function zoomAt(nz, px, py) {
    nz = Math.min(MAX, Math.max(1, nz));
    tx = px - (px - tx) * nz / z;
    ty = py - (py - ty) * nz / z;
    z = nz;
    if (z <= 1.01) { z = 1; tx = ty = 0; }
    apply();
  }
  const center = () => { const { w, h } = size(); return [w / 2, h / 2]; };
  const local = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function reset() { z = 1; tx = ty = 0; apply(); }

  function showBar() {
    box.classList.remove("hide");
    clearTimeout(hideT);
    if (!vid.paused) hideT = setTimeout(() => box.classList.add("hide"), 3000);
  }
  function toggleBar() { if (box.classList.contains("hide")) showBar(); else if (!vid.paused) box.classList.add("hide"); }
  function togglePlay() { if (vid.paused) vid.play().catch(() => {}); else vid.pause(); }

  // Gestures on the video area (not on the control bar).
  box.addEventListener("pointerdown", e => {
    if (e.target.closest(".vbar, .vmenu")) return;
    try { box.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    pts.set(e.pointerId, local(e));
    moved = false; downAt = Date.now();
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      drag = null;
      endHold();
    } else if (pts.size === 1) {
      drag = { x: local(e)[0], y: local(e)[1] };
      // Hold still for half a second: 2x (3x if already at 2x or more) until the finger lifts.
      clearTimeout(holdT);
      holdT = setTimeout(() => {
        if (moved || pts.size !== 1 || vid.paused || menuOpen()) return;
        held = vid.playbackRate; vid.playbackRate = held >= 2 ? 3 : 2;
        $("fast").textContent = vid.playbackRate + "x ▸▸"; $("fast").hidden = false;
      }, 500);
    }
  });
  box.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) { if (e.pointerType === "mouse") showBar(); return; }
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      tx += mx - pinch.mx; ty += my - pinch.my; pinch.mx = mx; pinch.my = my;
      zoomAt(pinch.z * d / pinch.d, mx, my);
      moved = true;
    } else if (drag) {
      const dx = p[0] - drag.x, dy = p[1] - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) { moved = true; if (held === null) clearTimeout(holdT); }
      if (moved && z > 1) { tx += dx; ty += dy; apply(); }
      drag = { x: p[0], y: p[1] };
    }
  });
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [q] = pts.values(); drag = { x: q[0], y: q[1] }; return; }
    drag = null;
    if (endHold()) return;
    if (moved || Date.now() - downAt > 400 || e.type === "pointercancel") return;
    if (menuOpen()) { $("vmenu").hidden = true; return; }
    const now = Date.now();
    if (now - lastTap < 300) {            // double tap: zoom in at that point, or back to 1x
      clearTimeout(tapT); lastTap = 0;
      if (z > 1.01) reset(); else zoomAt(2.5, p[0], p[1]);
      return;
    }
    lastTap = now;
    const mouse = e.pointerType === "mouse";
    tapT = setTimeout(() => { if (mouse) togglePlay(); toggleBar(); }, 300);
  }
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
  box.addEventListener("wheel", e => {
    if (e.target.closest(".vbar, .vmenu")) return;
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), px, py);
  }, { passive: false });
  box.addEventListener("dblclick", e => e.preventDefault());
  new ResizeObserver(() => { apply(); if (typeof styleSubs === "function") styleSubs(); }).observe(box);

  // Control bar.
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };
  function syncBar() {
    $("bplay").textContent = vid.paused ? "▶" : "❚❚";
    $("tnow").textContent = fmt(vid.currentTime); $("tdur").textContent = fmt(vid.duration);
    if (!seeking && vid.duration) $("seek").value = Math.round(vid.currentTime / vid.duration * 1000);
  }
  ["timeupdate", "play", "pause", "loadedmetadata", "durationchange"].forEach(ev => vid.addEventListener(ev, syncBar));
  vid.addEventListener("play", showBar);
  vid.addEventListener("pause", showBar);
  $("seek").addEventListener("input", () => { seeking = true; if (vid.duration) $("tnow").textContent = fmt($("seek").value / 1000 * vid.duration); });
  $("seek").addEventListener("change", () => { if (vid.duration) vid.currentTime = $("seek").value / 1000 * vid.duration; seeking = false; });
  $("bplay").onclick = togglePlay;
  $("bback").onclick = () => { vid.currentTime = Math.max(0, vid.currentTime - 10); };
  $("bfwd").onclick = () => { vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10); };
  $("zin").onclick = () => zoomAt(z * 1.5, ...center());
  $("zout").onclick = () => zoomAt(z / 1.5, ...center());
  $("zreset").onclick = reset;
  // ---------- speed (any value from 0.25x to 3x, like YouTube) ----------
  function setSpeed(s) {
    s = Math.round(Math.min(3, Math.max(0.25, +s || 1)) * 100) / 100;
    held = null; $("fast").hidden = true;
    vid.playbackRate = s; $("bspeed").textContent = s + "x ⚙"; $("mspeed").textContent = s + "x";
    $("rspeed").value = s;
    $("speeds").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.s === s));
    try { localStorage.setItem("speed", s); } catch (_) { /* storage blocked */ }
  }
  $("speeds").innerHTML = SPEEDS.map(s => `<button data-s="${s}">${s === 1 ? "Normal" : s + "x"}</button>`).join("");
  $("speeds").onclick = e => { const b = e.target.closest("button"); if (b) setSpeed(b.dataset.s); };
  $("rspeed").oninput = () => setSpeed($("rspeed").value);
  $("bspeed").onclick = () => { $("vmenu").hidden = !$("vmenu").hidden; showBar(); };

  // ---------- subtitles: own overlay so size, color and background can be chosen ----------
  const COLORS = ["#ffffff", "#ffeb3b", "#7fffd4", "#9be15d", "#ffb4a2"];
  const BGS = [["no", "Sin fondo"], ["semi", "Semitransparente"], ["solid", "Negro"]];
  const POS = [["bottom", "Abajo"], ["top", "Arriba"]];
  let cues = [], sp = { on: true, size: 22, color: "#ffffff", bg: "semi", shadow: true, pos: "bottom" };
  try { sp = { ...sp, ...JSON.parse(localStorage.getItem("subs") || "{}") }; } catch (_) { /* storage blocked */ }
  function styleSubs() {
    // Size is chosen for a 360 px tall video and grows or shrinks with the player (phone, PC, full screen).
    const t = $("subtxt").style, k = Math.min(2, Math.max(0.6, box.clientHeight / 360));
    t.fontSize = Math.round(sp.size * k) + "px";
    t.color = sp.color;
    t.background = sp.bg === "no" ? "transparent" : sp.bg === "semi" ? "rgba(0,0,0,.55)" : "#000";
    t.textShadow = sp.shadow ? "0 0 3px #000, 0 0 3px #000, 1px 1px 2px #000" : "none";
    $("subs").classList.toggle("top", sp.pos === "top");
    $("son").checked = sp.on; $("ssize").value = sp.size; $("ssizev").textContent = sp.size + " px"; $("sshadow").checked = sp.shadow;
    $("bcc").classList.toggle("on", sp.on && cues.length > 0);
    $("bcc").classList.toggle("off", !cues.length);
    $("snone").textContent = cues.length ? "" : "(este video aún no tiene)";
    [["scolors", sp.color], ["sbgs", sp.bg], ["spos", sp.pos]].forEach(([id, v]) =>
      $(id).querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)));
    showCue();
  }
  function saveSubs() { try { localStorage.setItem("subs", JSON.stringify(sp)); } catch (_) { /* storage blocked */ } styleSubs(); }
  $("scolors").innerHTML = COLORS.map(c => `<button class="sw" data-v="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join("");
  $("sbgs").innerHTML = BGS.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join("");
  $("spos").innerHTML = POS.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join("");
  const pick = (id, key) => { $(id).onclick = e => { const b = e.target.closest("button"); if (b) { sp[key] = b.dataset.v; saveSubs(); } }; };
  pick("scolors", "color"); pick("sbgs", "bg"); pick("spos", "pos");
  $("son").onchange = () => { sp.on = $("son").checked; saveSubs(); };
  $("sshadow").onchange = () => { sp.shadow = $("sshadow").checked; saveSubs(); };
  $("ssize").oninput = () => { sp.size = +$("ssize").value; saveSubs(); };
  $("bcc").onclick = () => { if (!cues.length) { $("vmenu").hidden = false; return; } sp.on = !sp.on; saveSubs(); };
  let lastCue = null;
  function showCue() {
    const t = vid.currentTime, c = sp.on ? cues.find(x => t >= x.a && t <= x.b) : null;
    if (c === lastCue) return;
    lastCue = c;
    $("subs").hidden = !c; $("subtxt").textContent = c ? c.t : "";
  }
  vid.addEventListener("timeupdate", showCue);
  vid.addEventListener("seeked", showCue);
  const sec = s => { const p = s.trim().split(":").map(parseFloat); return p.reduce((acc, x) => acc * 60 + x, 0); };
  // Whisper sometimes makes one huge block (a whole paragraph) or keeps a line on screen through a long
  // silence. Split blocks into pieces of at most 2 lines (about 84 letters), timed by length, drop
  // repeated lines, and hide a piece once it has been on screen long enough to read it.
  const MAXC = 84;
  function pieces(t) {
    if (t.length <= MAXC) return [t];
    const out = []; let cur = "";
    for (const w of t.split(" ")) {
      if (cur && (cur + " " + w).length > MAXC) { out.push(cur); cur = w; }
      else cur = cur ? cur + " " + w : w;
      // Prefer to cut after a sentence or a comma once the piece is long enough.
      if (cur.length >= 45 && /[.,;:?!]$/.test(w)) { out.push(cur); cur = ""; }
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
        out.push({ a: at, b: Math.min(end, at + 2 + x.length * 0.09), t: x });
        at = end;
      }
    }
    return out;
  }
  function setSubs(text) {
    cues = [];
    for (const block of (text || "").replace(/\r/g, "").split(/\n\n+/)) {
      const lines = block.split("\n"), i = lines.findIndex(l => l.includes("-->"));
      if (i < 0) continue;
      const [a, b] = lines[i].split("-->");
      const t = lines.slice(i + 1).join(" ").replace(/\s+/g, " ").trim();
      if (t) cues.push({ a: sec(a), b: sec(b.split(" ").filter(Boolean)[0]), t });
    }
    cues = tidy(cues);
    lastCue = undefined; styleSubs();
  }
  styleSubs();
  vid.addEventListener("loadedmetadata", () => {
    let s = 1;
    try { s = +localStorage.getItem("speed") || 1; } catch (_) { /* storage blocked */ }
    setSpeed(s);
  });
  async function full() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (box.requestFullscreen) {
      await box.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      try { await screen.orientation.lock("landscape"); } catch (_) { /* not supported on this device */ }
    } else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
    else if (vid.webkitEnterFullscreen) vid.webkitEnterFullscreen();  // iPhone: native player, no custom zoom
  }
  $("bfull").onclick = full;
  document.addEventListener("fullscreenchange", () => {
    $("bfull").classList.toggle("on", !!document.fullscreenElement);
    if (!document.fullscreenElement) { try { screen.orientation.unlock(); } catch (_) { /* not supported */ } }
    requestAnimationFrame(apply);
    styleSubs();
  });

  document.addEventListener("keydown", e => {
    if (!document.getElementById("player").classList.contains("open") || e.target.matches("textarea, input[type=text], input:not([type])")) return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); togglePlay(); }
    else if (k === "ArrowLeft") vid.currentTime = Math.max(0, vid.currentTime - 10);
    else if (k === "ArrowRight") vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
    else if (k === "+" || k === "=") zoomAt(z * 1.5, ...center());
    else if (k === "-") zoomAt(z / 1.5, ...center());
    else if (k === "0") reset();
    else if (k === "f" || k === "F") full();
    else if (k === "c" || k === "C") $("bcc").click();
    else if (k === ">" || k === ".") setSpeed(vid.playbackRate + 0.25);
    else if (k === "<" || k === ",") setSpeed(vid.playbackRate - 0.25);
    else return;
    showBar();
  });

  return { reset, showBar, setSubs, exitFull() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } };
})();
