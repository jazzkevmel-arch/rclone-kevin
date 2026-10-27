// Player controls with zoom, made for reading PLC programs on a small phone screen.
// Phone: pinch to zoom, double tap to zoom in at that spot (or back to 1x), drag to move, tap to show the controls.
// PC: mouse wheel to zoom, drag to move, click to play or pause, keys + − 0 F, space and arrows.
const Zoom = (() => {
  const box = document.getElementById("vbox"), vid = document.getElementById("video");
  const $ = id => document.getElementById(id);
  const MAX = 6, SPEEDS = [1, 1.25, 1.5, 1.75, 2];
  let z = 1, tx = 0, ty = 0, hideT = null, tapT = null, lastTap = 0, seeking = false;
  const pts = new Map();
  let pinch = null, drag = null, moved = false, downAt = 0;

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
    if (e.target.closest(".vbar")) return;
    box.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    moved = false; downAt = Date.now();
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      drag = null;
    } else if (pts.size === 1) {
      drag = { x: local(e)[0], y: local(e)[1] };
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
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
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
    if (moved || Date.now() - downAt > 400 || e.type === "pointercancel") return;
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
    if (e.target.closest(".vbar")) return;
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), px, py);
  }, { passive: false });
  box.addEventListener("dblclick", e => e.preventDefault());
  new ResizeObserver(apply).observe(box);

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
  function setSpeed(s) {
    vid.playbackRate = s; $("bspeed").textContent = s + "x";
    try { localStorage.setItem("speed", s); } catch (_) { /* storage blocked */ }
  }
  $("bspeed").onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(vid.playbackRate) + 1) % SPEEDS.length] || 1);
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
    else return;
    showBar();
  });

  return { reset, showBar, exitFull() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } };
})();
