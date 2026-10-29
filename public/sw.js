// Keeps the app working offline. Bump VERSION whenever a file changes so phones pick up the update.
const VERSION = "stringbed-v14";
const FILES = ["./", "index.html", "tension.js", "restring.js", "courts.js", "stringjobs.js", "shoes.js", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first, so a new version shows up as soon as the phone is online. But on weak court
// Wi-Fi a request can hang for a long time, so after NET_WAIT the saved copy is shown instead and
// the network answer still refreshes the cache in the background for next time.
const NET_WAIT = 2500;
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // never cache account data
  const net = fetch(req).then(res => {
    if (res.ok && url.origin === location.origin) {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  });
  e.waitUntil(net.then(() => {}, () => {}));
  e.respondWith((async () => {
    const waited = new Promise(r => setTimeout(r, NET_WAIT, null));
    try { const first = await Promise.race([net, waited]); if (first) return first; } catch {}
    const saved = await caches.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await caches.match("index.html") : null);
    return saved || net; // nothing saved: keep waiting for the network
  })());
});

// Restring reminders (Web Push, sent by the daily check in lib/push.js).
self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Stringbed Meter", {
    body: m.body || "", tag: m.tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: m.url || "./" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
