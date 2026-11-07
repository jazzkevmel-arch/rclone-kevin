// Gemini calls (Google AI Studio key, saved only in the user's Drive config.json).
// prueba/mock.js replaces IA.call to test without a key.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/";

const IA = {
  key: "", model: "", models: null,

  // Flash models this key can use, best first: stable "gemini-X.Y-flash", then "-flash-lite", newest version first.
  // When one is overloaded (503) or out of free quota (429), call() moves on to the next.
  async listModels() {
    const fallback = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    try {
      const r = await fetch(GEMINI + "models?pageSize=200&key=" + encodeURIComponent(this.key));
      if (!r.ok) return fallback;
      const names = ((await r.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0)
        .map(m => m.name.replace("models/", ""))
        .filter(n => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(n));
      const ver = n => parseFloat(n.split("-")[1]);
      names.sort((a, b) => (/-lite$/.test(a) - /-lite$/.test(b)) || ver(b) - ver(a));
      return names.length ? names : fallback;
    } catch (_) { return fallback; }
  },
  async pickModel() { this.models = await this.listModels(); return this.models[0]; },

  // Kinds of failure: "key" (bad key: stop), "busy" (try again or another model), "other".
  async callOnce(model, body) {
    const r = await fetch(GEMINI + "models/" + model + ":generateContent?key=" + encodeURIComponent(this.key), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (r.ok) return { d: await r.json() };
    const t = await r.text();
    if ((r.status === 400 || r.status === 403) && /API key|API_KEY|PERMISSION_DENIED/i.test(t)) return { err: "key", status: r.status };
    if (r.status === 429 || r.status === 503 || r.status === 500 || r.status === 404) return { err: "busy", status: r.status };
    return { err: "other", status: r.status, text: t };
  },

  async call(body) {
    if (!this.key) throw new Error("Falta tu clave de Gemini. Ve a Ajustes.");
    const order = [this.model].concat((this.models || []).filter(m => m !== this.model));
    let last = null, triedList = !!this.models;
    for (let i = 0; i < order.length; i++) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.callOnce(order[i], body);
        if (res.d) {
          if (order[i] !== this.model) { this.model = order[i]; this.onModel && this.onModel(order[i]); }
          return this.text(res.d);
        }
        last = res;
        if (res.err === "key") throw new Error("La clave de Gemini no funciona. Revísala en Ajustes.");
        if (res.err === "other") throw new Error("Gemini " + res.status + ": " + (res.text || "").slice(0, 160));
        if (res.status === 404 || res.status === 429) break; // that model is gone or out of quota: next one
        await new Promise(ok => setTimeout(ok, 1500 * (attempt + 1)));
      }
      if (i === order.length - 1 && !triedList) { // first failure on the saved model: learn the other models
        triedList = true;
        this.models = await this.listModels();
        order.push.apply(order, this.models.filter(m => order.indexOf(m) < 0));
      }
    }
    throw new Error(last && last.status === 429
      ? "Llegaste al límite gratis de Gemini por hoy en todos los modelos. Prueba más tarde."
      : "Gemini está saturado ahora mismo. Prueba en unos minutos.");
  },

  text(d) {
    const c = d.candidates && d.candidates[0];
    const text = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || "").join("") : "";
    if (!text) throw new Error("Gemini no devolvió respuesta" + (c && c.finishReason ? " (" + c.finishReason + ")" : "") + ".");
    return text;
  },

  // Study items for one lesson, made only from its transcript.
  async lesson(course, title, transcript) {
    const S = { type: "STRING" };
    const schema = {
      type: "OBJECT",
      properties: {
        resumen: { type: "ARRAY", items: { type: "OBJECT", properties: { titulo: S, texto: S }, required: ["titulo", "texto"] } },
        tarjetas: { type: "ARRAY", items: { type: "OBJECT", properties: { f: S, b: S }, required: ["f", "b"] } },
        quiz: { type: "ARRAY", items: { type: "OBJECT", properties: { q: S, o: { type: "ARRAY", items: S }, c: { type: "INTEGER" }, e: S }, required: ["q", "o", "c", "e"] } },
        vf: { type: "ARRAY", items: { type: "OBJECT", properties: { s: S, v: { type: "BOOLEAN" }, e: S }, required: ["s", "v", "e"] } },
      },
      required: ["resumen", "tarjetas", "quiz", "vf"],
    };
    const prompt =
      "Eres un profesor que prepara material de estudio en español para un técnico que estudia este curso.\n" +
      "Curso: " + course + "\nLección: " + title + "\n\n" +
      "Usa SOLO lo que se explica en la transcripción de abajo (es audio transcrito, puede tener errores: corrígelos con sentido común). " +
      "Ignora saludos, relleno y avisos del profesor.\n" +
      "Devuelve:\n" +
      "- resumen: 3 a 6 secciones cortas (titulo y texto de 2 a 4 frases) con las ideas clave, pasos y valores concretos.\n" +
      "- tarjetas: 8 a 12 tarjetas (f = pregunta o concepto, b = respuesta breve).\n" +
      "- quiz: 6 preguntas de opción múltiple con 4 opciones (o), el índice de la correcta (c, de 0 a 3) y una explicación breve (e). Varía la posición de la correcta.\n" +
      "- vf: 6 afirmaciones de verdadero o falso (s), si es verdadera (v) y por qué (e). Mitad verdaderas, mitad falsas.\n" +
      "Pregunta conceptos, pasos y datos útiles, no detalles triviales.\n\nTRANSCRIPCIÓN:\n" + transcript.slice(0, 120000);
    const text = await this.call({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 },
    });
    const d = JSON.parse(text);
    d.quiz = (d.quiz || []).filter(x => x.o && x.o.length >= 2 && x.c >= 0 && x.c < x.o.length);
    return d;
  },

  // Tutor chat. history: [{ role: "user"|"model", text, img? { mime, data } }]. context: lesson transcript or "".
  async chat(history, context, lessonTitle) {
    const sys =
      "Eres Repasa, un tutor paciente que habla español de Perú de forma clara y cercana. " +
      "Explica paso a paso, con ejemplos prácticos de planta industrial cuando ayude, y comprueba que el alumno entendió con una pregunta corta al final. " +
      "Si te mandan una foto de un ejercicio, resuélvelo paso a paso. Usa listas y negritas con moderación (formato Markdown simple)." +
      (context ? "\n\nEl alumno está estudiando la lección «" + lessonTitle + "». Básate primero en esta transcripción de la clase; si algo no está en ella, dilo y explica con tu conocimiento general.\n\nTRANSCRIPCIÓN:\n" + context.slice(0, 100000) : "");
    const contents = history.map(m => ({
      role: m.role,
      parts: [].concat(m.img ? [{ inline_data: { mime_type: m.img.mime, data: m.img.data } }] : [], [{ text: m.text || "¿Qué ves en esta imagen?" }]),
    }));
    return this.call({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.6 } });
  },
};
