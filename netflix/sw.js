// Service worker: plays Google Drive videos in a normal <video> tag.
// The page asks for ./v/<fileId>; this worker fetches the file from the Drive API with the
// user's access token and passes the Range header through, so seeking works.
const API = "https://www.googleapis.com/drive/v3/files/";
let token = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("message", e => { if (e.data && e.data.token !== undefined) token = e.data.token; });

// The worker can be stopped and restarted at any time, losing the token. Ask an open page for it.
async function getToken() {
  if (token) return token;
  for (const c of await self.clients.matchAll({ type: "window" })) {
    const t = await new Promise(res => {
      const ch = new MessageChannel();
      ch.port1.onmessage = m => res(m.data && m.data.token);
      c.postMessage({ needToken: true }, [ch.port2]);
      setTimeout(() => res(null), 2000);
    });
    if (t) return (token = t);
  }
  return null;
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const m = url.origin === self.location.origin && url.pathname.match(/\/v\/([\w-]+)$/);
  if (!m) return;
  e.respondWith((async () => {
    const t = await getToken();
    if (!t) return new Response("sin sesión", { status: 401 });
    const headers = { Authorization: "Bearer " + t };
    const range = e.request.headers.get("Range");
    if (range) headers.Range = range;
    const r = await fetch(API + m[1] + "?alt=media&supportsAllDrives=true", { headers });
    if (r.status === 401) {
      token = null;
      for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ expired: true });
    }
    return r;
  })());
});
