// Oral exam by voice with the Gemini Live API (WebSocket, audio in and out).
// Mic: 16 kHz PCM16 sent as realtimeInput. Speaker: 24 kHz PCM16 played in order.
// Half duplex: while the examiner speaks the mic is not sent, so it never hears (and answers) itself.
const LIVE_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=";

const Voz = {
  // Best live voice model for this key: "gemini-X.Y-live", then "*-flash-live*", then "*native-audio-latest".
  async pickModel(key) {
    try {
      const r = await fetch(GEMINI + "models?pageSize=300&key=" + encodeURIComponent(key));
      const names = ((await r.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).indexOf("bidiGenerateContent") >= 0)
        .map(m => m.name.replace("models/", ""))
        .filter(n => !/translate|transcribe|robotics|thinking/.test(n));
      const ver = n => parseFloat((n.match(/(\d+(\.\d+)?)/) || [0, 0])[1]);
      const rank = n => /^gemini-[\d.]+-live$/.test(n) ? 0 : /flash-live/.test(n) ? 1 : /native-audio-latest/.test(n) ? 2 : 3;
      names.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a));
      return names[0] || "gemini-2.5-flash-native-audio-latest";
    } catch (_) { return "gemini-2.5-flash-native-audio-latest"; }
  },

  persona(nivel) {
    const base =
      "Eres el PROFE FLORO, examinador oral de la app Repasa. Hablas español de Perú, rápido y con jerga limeña: " +
      "causa, pata, manyas, chamba, ya fue, habla, al toque, chévere, bacán, pucha, qué tal floro, joven. " +
      "Tu muletilla: cuando el alumno da vueltas sin decir nada concreto, le dices que te está floreando. " +
      "Inventas comparaciones graciosas peruanas (más perdido que cuy en tómbola, más lento que combi en hora punta). " +
      "Te ríes de las RESPUESTAS, nunca de la persona, su físico, origen o familia.";
    const tono = {
      tranqui: " Tono: buena onda y paciente, bromas suaves, celebras mucho los aciertos.",
      pesado: " Tono: sarcástico y picón como profe exigente que roche al alumno, pero se nota que lo quiere. Celebras los aciertos con sorpresa exagerada (¡milagro!).",
      sinfiltro: " Tono: sin filtro, roche fuerte y lisuras peruanas de confianza (pucha, carajo, huevón, pendejo, conchesumare en broma) como entre patas. Nunca odio, nunca discriminación; solo roche a las respuestas.",
    };
    return base + (tono[nivel] || tono.pesado);
  },

  rules(n, title, transcript) {
    return "\n\nREGLAS DEL EXAMEN:\n" +
      "- Examen oral de " + n + " preguntas sobre la lección «" + title + "», sacadas SOLO de la transcripción de abajo (es audio transcrito: corrige errores obvios).\n" +
      "- Empieza con un saludo picón de una frase y lanza la pregunta 1. Una pregunta a la vez, corta y clara, de concepto o de práctica en planta.\n" +
      "- Espera la respuesta. Si es buena, celebra corto y pasa a la siguiente. Si es mala o incompleta, roche corto y di la respuesta correcta en 1 o 2 frases, luego sigue.\n" +
      "- Si el alumno dice 'paso' o no sabe, roche y da la respuesta. Si pide repetir, repite.\n" +
      "- Frases cortas: es voz, no leas listas. Nunca más de 3 frases seguidas.\n" +
      "- Al terminar la última pregunta (o si el alumno pide terminar), di tu veredicto gracioso en 1 o 2 frases y LLAMA a terminar_examen con la nota de 0 a 100, un resumen y los temas que falló.\n\n" +
      "TRANSCRIPCIÓN DE LA CLASE:\n" + transcript.slice(0, 30000);
  },

  tool: {
    functionDeclarations: [{
      name: "terminar_examen",
      description: "Cierra el examen oral y guarda la nota del alumno.",
      parameters: {
        type: "OBJECT",
        properties: {
          nota: { type: "INTEGER", description: "Nota de 0 a 100" },
          resumen: { type: "STRING", description: "Veredicto en una o dos frases" },
          fallos: { type: "ARRAY", items: { type: "STRING" }, description: "Temas que falló o respondió flojo" },
        },
        required: ["nota", "resumen"],
      },
    }],
  },

  // opts: { key, model, voice, system, onState(s), onLevel(0..1), onCaption(who, text), onEnd(result|null, err) }
  async start(opts) {
    const S = this.s = { opts, closed: false, speakingUntil: 0, sources: [], next: 0, buf: [], bufLen: 0, result: null };
    S.out = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    S.inCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const worklet = "class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('rec',R)";
    await S.inCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: "application/javascript" })));
    const src = S.inCtx.createMediaStreamSource(S.stream);
    S.node = new AudioWorkletNode(S.inCtx, "rec");
    src.connect(S.node);
    S.node.port.onmessage = e => this.mic(e.data);
    try { S.lock = await navigator.wakeLock.request("screen"); } catch (_) { /* optional */ }

    opts.onState("conectando");
    S.ws = new WebSocket(LIVE_WS + encodeURIComponent(opts.key));
    S.ws.onopen = () => S.ws.send(JSON.stringify({ setup: {
      model: "models/" + opts.model,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || "Puck" } } } },
      systemInstruction: { parts: [{ text: opts.system }] },
      tools: [this.tool],
      inputAudioTranscription: {}, outputAudioTranscription: {},
    } }));
    S.ws.onmessage = async e => {
      const txt = typeof e.data === "string" ? e.data : await e.data.text();
      let m; try { m = JSON.parse(txt); } catch (_) { return; }
      this.onServer(m);
    };
    S.ws.onerror = () => {};
    S.ws.onclose = e => {
      if (S.closed) return;
      const err = e.code === 1000 ? null : (e.reason || "La conexión con Gemini se cortó (" + e.code + ").");
      this.stop(); opts.onEnd(S.result, err);
    };
  },

  onServer(m) {
    const S = this.s, o = S.opts;
    if (m.setupComplete) {
      S.ready = true;
      S.speakingUntil = performance.now() + 2500; // wait for the greeting before listening
      o.onState("hablando");
      S.ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "Hola profe, estoy listo. Empieza el examen." }] }], turnComplete: true } }));
      return;
    }
    if (m.toolCall) {
      for (const f of m.toolCall.functionCalls || []) {
        if (f.name === "terminar_examen") S.result = f.args || {};
        S.ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id: f.id, name: f.name, response: { ok: true } }] } }));
      }
      // Let the last words play, then close.
      if (S.result) setTimeout(() => { if (!S.closed) { const r = S.result; this.stop(); o.onEnd(r, null); } }, Math.max(1500, (S.next - S.out.currentTime) * 1000 + 800));
      return;
    }
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) this.flush();
    for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) if (p.inlineData && /audio/.test(p.inlineData.mimeType)) this.play(p.inlineData.data);
    if (sc.outputTranscription && sc.outputTranscription.text) o.onCaption("profe", sc.outputTranscription.text);
    if (sc.inputTranscription && sc.inputTranscription.text) o.onCaption("tu", sc.inputTranscription.text);
    if (sc.turnComplete) o.onCaption("fin");
  },

  play(b64) {
    const S = this.s, bin = atob(b64), n = bin.length >> 1, f = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; f[i] = v / 32768; sum += f[i] * f[i]; }
    const ab = S.out.createBuffer(1, n, 24000); ab.copyToChannel(f, 0);
    const node = S.out.createBufferSource(); node.buffer = ab; node.connect(S.out.destination);
    const t = Math.max(S.out.currentTime + 0.05, S.next);
    node.start(t); S.next = t + ab.duration; S.sources.push(node);
    node.onended = () => { S.sources = S.sources.filter(x => x !== node); };
    S.speakingUntil = performance.now() + (S.next - S.out.currentTime) * 1000 + 400;
    S.opts.onState("hablando");
    S.opts.onLevel(Math.min(1, Math.sqrt(sum / n) * 4));
  },

  flush() { const S = this.s; S.sources.forEach(x => { try { x.stop(); } catch (_) { /* ended */ } }); S.sources = []; S.next = 0; S.speakingUntil = 0; },

  mic(chunk) {
    const S = this.s; if (!S || S.closed || !S.ready || !S.ws || S.ws.readyState !== 1) return;
    if (performance.now() < S.speakingUntil) return;          // examiner talking: do not send
    if (S.muted) chunk = new Float32Array(chunk.length);      // muted: send silence so turns still end
    S.opts.onState("escuchando");
    S.buf.push(chunk); S.bufLen += chunk.length;
    if (S.bufLen < 1600) return;                              // send every 100 ms
    const all = new Int16Array(S.bufLen); let k = 0, sum = 0;
    for (const c of S.buf) for (let i = 0; i < c.length; i++) { const v = Math.max(-1, Math.min(1, c[i])); all[k++] = v * 32767; sum += v * v; }
    S.buf = []; S.bufLen = 0;
    S.opts.onLevel(Math.min(1, Math.sqrt(sum / all.length) * 6));
    const bytes = new Uint8Array(all.buffer); let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    S.ws.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(s), mimeType: "audio/pcm;rate=16000" } } }));
  },

  say(text) { const S = this.s; if (S && S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } })); },
  mute(on) { if (this.s) this.s.muted = on; },

  stop() {
    const S = this.s; if (!S || S.closed) return;
    S.closed = true;
    try { S.ws && S.ws.close(1000); } catch (_) { /* closed */ }
    try { S.stream && S.stream.getTracks().forEach(t => t.stop()); } catch (_) { /* stopped */ }
    try { S.inCtx && S.inCtx.close(); } catch (_) { /* closed */ }
    setTimeout(() => { try { S.out && S.out.close(); } catch (_) { /* closed */ } }, 300);
    try { S.lock && S.lock.release(); } catch (_) { /* released */ }
  },
};
