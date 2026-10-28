// Google sign-in and Google Drive helpers for Netflix PLC.
// Everything private (course list, progress) lives in the user's own Drive, never in this repository.
const CLIENT_ID = "1078206882064-64g58hf4f8q26jgnu0k04far83it9ua3.apps.googleusercontent.com";
// Full Drive access: needed to read the courses shared with the user and to update the progress
// files that the PC (Google Drive for desktop) also edits.
const SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3/";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

const Drive = {
  token: null, exp: 0, client: null, onToken: null, onExpired: null,

  init() {
    try {
      const s = JSON.parse(localStorage.getItem("gtoken") || "null");
      if (s && s.exp > Date.now() + 60000) { this.token = s.t; this.exp = s.exp; }
    } catch (_) { /* storage blocked */ }
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        if (r.error) return;
        this.token = r.access_token;
        this.exp = Date.now() + (r.expires_in - 60) * 1000;
        try { localStorage.setItem("gtoken", JSON.stringify({ t: this.token, exp: this.exp })); } catch (_) { /* storage blocked */ }
        try { localStorage.setItem("glogged", "1"); } catch (_) { /* storage blocked */ }
        this.onToken && this.onToken(this.token);
      },
    });
    return !!this.token;
  },
  // Must run from a tap or click: it opens Google's sign-in window.
  // Google tokens last 1 hour and this static site has no server to refresh them. So, after the first
  // sign-in, the saved email goes as login_hint: Google skips the account chooser and the window closes by itself.
  login() {
    let known = false, email = "";
    try { known = !!localStorage.getItem("glogged"); email = localStorage.getItem("gmail") || ""; } catch (_) { /* storage blocked */ }
    this.lastTry = Date.now();
    this.client.requestAccessToken({ prompt: known ? "" : "consent", ...(email ? { login_hint: email } : {}) });
  },
  // Called on every tap: renews the token in the background when it is about to expire.
  // A tap is needed because browsers block the Google window without one.
  renewOnTap() {
    let known = false;
    try { known = !!localStorage.getItem("glogged"); } catch (_) { /* storage blocked */ }
    if (known && this.client && this.minutesLeft() <= 10 && Date.now() - (this.lastTry || 0) > 120000) this.login();
  },
  async rememberEmail() {
    try {
      if (localStorage.getItem("gmail")) return;
      const r = await this.req(API + "about?fields=user(emailAddress)");
      localStorage.setItem("gmail", (await r.json()).user.emailAddress);
    } catch (_) { /* optional */ }
  },
  valid() { return this.token && Date.now() < this.exp; },
  minutesLeft() { return Math.max(0, Math.round((this.exp - Date.now()) / 60000)); },

  async req(url, opt = {}) {
    if (!this.valid()) { this.onExpired && this.onExpired(); throw new Error("sesión vencida"); }
    const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + this.token } });
    if (r.status === 401) { this.token = null; this.onExpired && this.onExpired(); throw new Error("sesión vencida"); }
    if (!r.ok) throw new Error("Drive " + r.status + ": " + (await r.text()).slice(0, 200));
    return r;
  },
  async find(parent, name, folder) {
    const q = `'${parent}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false` +
      (folder ? ` and mimeType='${FOLDER}'` : "");
    const r = await this.req(API + "files?fields=files(id,modifiedTime)&orderBy=modifiedTime desc&q=" + encodeURIComponent(q));
    return (await r.json()).files[0] || null;
  },
  async folder(parent, name) {
    const f = await this.find(parent, name, true);
    if (f) return f.id;
    const r = await this.req(API + "files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
    return (await r.json()).id;
  },
  async read(id) { return (await this.req(API + "files/" + id + "?alt=media")).text(); },
  async meta(id) { return (await this.req(API + "files/" + id + "?fields=modifiedTime")).json(); },
  // Creates the file, or replaces its content when id is given.
  async write(parent, name, text, mime, id) {
    if (id) {
      const r = await this.req(UPLOAD + "/" + id + "?uploadType=media&fields=id,modifiedTime",
        { method: "PATCH", headers: { "Content-Type": mime }, body: text });
      return r.json();
    }
    const b = "plc" + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [parent] }) + `\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${b}--`;
    const r = await this.req(UPLOAD + "?uploadType=multipart&fields=id,modifiedTime",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body });
    return r.json();
  },
  // Uploads a photo or screenshot (a File or Blob) as a new file.
  async upload(parent, name, blob) {
    const b = "plc" + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [parent] }) + `\r\n--${b}\r\nContent-Type: ${blob.type || "image/png"}\r\n\r\n`,
      blob, `\r\n--${b}--`]);
    const r = await this.req(UPLOAD + "?uploadType=multipart&fields=id",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body });
    return r.json();
  },
};
