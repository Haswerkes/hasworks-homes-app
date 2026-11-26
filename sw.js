// Offline-first service worker (UX-003/UX-004).
// Install: precache the small app shell listed in /precache.json `files` (what first paint and offline start need).
// Heavy lazy chunks (`warm`: three.js views, Site, Level, Library; `ifc`: the IFC engine) are fetched only when the page
// posts {type:"warm"} after first paint, so they never compete with the first load on a slow link.
// Navigations: network-first (so a new build shows), falling back to the cached shell. Hashed assets: cache-first.
// Job packages (/jobs/...) and site data: cached on first fetch or when the crew taps "Save offline"; index.json network-first.
const JOBS = "acucut-jobs-v1";
let SHELL = "acucut-runtime"; // replaced by the versioned shell cache name at install
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const m = await (await fetch("/precache.json", { cache: "no-store" })).json();
    SHELL = `acucut-shell-${m.version}`;
    const c = await caches.open(SHELL);
    // add in small batches so one missing file does not fail the whole install
    for (let i = 0; i < m.files.length; i += 12) await Promise.all(m.files.slice(i, i + 12).map((f) => c.add(new Request(f, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const keys = await caches.keys(); const shells = keys.filter((k) => k.startsWith("acucut-shell-"));
  // keep only the newest shell cache (the one created by this install)
  const m = await fetch("/precache.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (m) await Promise.all(shells.filter((k) => k !== `acucut-shell-${m.version}`).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener("message", (e) => {
  if (e.data?.type !== "warm") return;
  e.waitUntil?.((async () => {
    const m = await fetch("/precache.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!m) return;
    const c = await caches.open(`acucut-shell-${m.version}`);
    const list = [...(m.warm || []), ...(e.data.ifc ? m.ifc || [] : [])];
    for (const f of list) { if (!(await c.match(f))) await c.add(new Request(f, { cache: "reload" })).catch(() => {}); }
  })());
});
const put = (name, req, res) => { if (res.ok) { const cp = res.clone(); caches.open(name).then((c) => c.put(req, cp)); } return res; };
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const isData = /^\/(jobs|sites|stakeout)\//.test(url.pathname);
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(async () => (await caches.match(e.request, { ignoreSearch: true, ignoreVary: true })) || caches.match("/", { ignoreVary: true })));
    return;
  }
  if (url.pathname.endsWith("/index.json") || url.pathname === "/precache.json" || url.pathname === "/library/library.json") {
    e.respondWith(fetch(e.request).then((r) => put(isData ? JOBS : SHELL, e.request, r)).catch(() => caches.match(e.request, { ignoreVary: true })));
    return;
  }
  // ignoreVary: module scripts and stylesheets are requested with crossorigin (they carry an Origin header), and servers
  // that send "Vary: Origin" would otherwise never match the copy cached at install, so lazy views failed offline
  e.respondWith(caches.match(e.request, { ignoreVary: true }).then((hit) => hit || fetch(e.request).then((r) => put(isData ? JOBS : SHELL, e.request, r))));
});
