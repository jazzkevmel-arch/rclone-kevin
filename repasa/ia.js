// Gemini calls (Google AI Studio key, saved only in the user's Drive config.json).
// prueba/mock.js replaces IA.call to test without a key.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/";

const IA = {
  key: "", model: "",

  // Picks the newest stable "gemini-X.Y-flash" model this key can use. Falls back to a known name.
  async pickModel() {
    try {
      const r = await fetch(GEMINI + "models?pageSize=200&key=" + encodeURIComponent(this.key));
      if (!r.ok) return "gemini-2.5-flash";
      const names = ((await r.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0)
        .map(m => m.name.replace("models/", ""))
        .filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n));
      names.sort((a, b) => parseFloat(b.split("-")[1]) - parseFloat(a.split("-")[1]));
      return names[0] || "gemini-2.5-flash";
    } catch (_) { return "gemini-2.5-flash"; }
  },

  async call(body) {
    if (!this.key) throw new Error("Falta tu clave de Gemini. Ve a Ajustes.");
    const r = await fetch(GEMINI + "models/" + this.model + ":generateContent?key=" + encodeURIComponent(this.key), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (r.status === 429) throw new Error("Llegaste al límite gratis de Gemini por ahora. Prueba en un rato.");
    if (r.status === 400 || r.status === 403) {
      const t = await r.text();
      if (/API key|API_KEY/i.test(t)) throw new Error("La clave de Gemini no funciona. Revísala en Ajustes.");
      throw new Error("Gemini " + r.status + ": " + t.slice(0, 160));
    }
    if (!r.ok) throw new Error("Gemini " + r.status + ": " + (await r.text()).slice(0, 160));
    const d = await r.json();
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
