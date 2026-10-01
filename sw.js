/* Nosso Lar: guarda uma cópia do app no aparelho para abrir e consultar sem internet */
const VERSION = "nossolar-v1";
const PHOTOS = "nossolar-fotos-v1"; // fotos já vistas (fica entre versões)
const PHOTOS_MAX = 400;
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== PHOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimPhotos(){
  const c = await caches.open(PHOTOS), ks = await c.keys();
  for (let i = 0; i < ks.length - PHOTOS_MAX; i++) await c.delete(ks[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // fotos do Storage (links assinados): o código do link muda a cada carregamento,
  // então a cópia é guardada pelo caminho da foto, sem o código
  if (url.pathname.includes("/storage/v1/object/sign/")) {
    const key = url.origin + url.pathname;
    e.respondWith(caches.open(PHOTOS).then(c => c.match(key).then(hit => hit ||
      fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { c.put(key, r.clone()).then(trimPhotos); } return r; }))));
    return;
  }
  if (url.hostname.endsWith("supabase.co")) return; // dados e login: sempre direto na internet

  // páginas: tenta a versão nova na internet; sem internet, usa a cópia guardada
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put("./index.html", cp)); } return r; })
      .catch(() => caches.match("./index.html", { ignoreSearch:true }).then(r => r || caches.match("./", { ignoreSearch:true }))));
    return;
  }
  // demais arquivos (biblioteca, fonte, ícones): usa a cópia e atualiza por trás
  const isAsset = url.origin === location.origin || url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!isAsset) return;
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});