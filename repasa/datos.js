// Repasa data layer. Everything private lives in the user's own Drive, never in this repository:
//   Mi unidad/Estudio/Repasa/        transcripciones/, contenido/, progreso.json, config.json
//   Mi unidad/Estudio/Netflix_PLC/   catalogo.json and cuestionarios.json (read only)
// prueba/mock.js replaces this object to test without Google.
const Store = {
  ids: {}, progId: null,

  async init() {
    const est = await Drive.find("root", "Estudio", true);
    if (!est) throw new Error("No encuentro la carpeta Estudio en tu Mi unidad.");
    this.ids.estudio = est.id;
    const plc = await Drive.find(est.id, "Netflix_PLC", true);
    if (!plc) throw new Error("No encuentro la carpeta Mi unidad/Estudio/Netflix_PLC.");
    this.ids.plc = plc.id;
    this.ids.repasa = await Drive.folder(est.id, "Repasa");
    this.ids.trans = await Drive.folder(this.ids.repasa, "transcripciones");
    this.ids.cont = await Drive.folder(this.ids.repasa, "contenido");
  },

  async json(parent, name, fallback) {
    const f = await Drive.find(parent, name);
    if (!f) return fallback;
    return JSON.parse((await Drive.read(f.id)).replace(/^﻿/, ""));
  },

  catalog() { return this.json(this.ids.plc, "catalogo.json", { cursos: [] }); },
  notebook() { return this.json(this.ids.plc, "cuestionarios.json", { videos: {}, tarjetas: {} }).catch(() => ({ videos: {}, tarjetas: {} })); },
  index() { return this.json(this.ids.trans, "indice.json", {}); },

  async transcript(course, n) {
    const fol = await Drive.find(this.ids.trans, course, true);
    if (!fol) return null;
    const f = await Drive.find(fol.id, String(n).padStart(2, "0") + ".txt");
    return f ? Drive.read(f.id) : null;
  },

  async content(course, n) {
    const fol = await Drive.find(this.ids.cont, course, true);
    return fol ? this.json(fol.id, String(n).padStart(2, "0") + ".json", null) : null;
  },
  async saveContent(course, n, data) {
    const fol = await Drive.folder(this.ids.cont, course);
    const name = String(n).padStart(2, "0") + ".json";
    const f = await Drive.find(fol, name);
    await Drive.write(fol, name, JSON.stringify(data), "application/json", f && f.id);
  },

  async config() { return this.json(this.ids.repasa, "config.json", {}); },
  async saveConfig(c) {
    const f = await Drive.find(this.ids.repasa, "config.json");
    await Drive.write(this.ids.repasa, "config.json", JSON.stringify(c), "application/json", f && f.id);
  },

  async progress() {
    const f = await Drive.find(this.ids.repasa, "progreso.json");
    if (!f) return null;
    this.progId = f.id;
    return JSON.parse(await Drive.read(f.id));
  },
  // Writes the merged progress. The caller merges with the remote copy first (see merge in app.js).
  async saveProgress(p) {
    const r = await Drive.write(this.ids.repasa, "progreso.json", JSON.stringify(p), "application/json", this.progId);
    if (r && r.id) this.progId = r.id;
  },
};
