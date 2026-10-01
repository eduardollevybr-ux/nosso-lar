/* Service worker do Controle | Eduardo Levy
   Guarda no aparelho o necessário para o app abrir sem internet.
   - Página (navegação): busca primeiro na internet; se falhar, usa a cópia guardada.
   - Biblioteca do Supabase, fonte e ícones: usa a cópia guardada e atualiza por trás.
   - Chamadas para *.supabase.co nunca são guardadas nem interceptadas. */

const CACHE = "controle-v1";
const SUPABASE_LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  SUPABASE_LIB,
  FONT_CSS
];
const NAV_TIMEOUT_MS = 5000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // um item por vez: se algum falhar (ex.: CDN fora do ar), os outros continuam
    await Promise.all(PRECACHE.map(async (url) => {
      try{
        const res = await fetch(url, { cache: "reload" });
        if(res && (res.ok || res.type === "opaque")) await cache.put(url, res);
      }catch(e){}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("controle-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSupabaseApi(url){
  return url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co");
}

async function networkFirstPage(request){
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(async (res) => {
    if(res && res.ok){
      const copy = res.clone();
      await cache.put("./index.html", copy);
    }
    return res;
  });
  network.catch(() => {});
  try{
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS))
    ]);
  }catch(e){
    const cached = (await cache.match("./index.html")) || (await cache.match("./")) ||
                   (await cache.match(request, { ignoreSearch: true }));
    if(cached) return cached;
    // sem cópia guardada: espera a internet mesmo (ou devolve o erro)
    return network;
  }
}

async function staleWhileRevalidate(event){
  const request = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const update = fetch(request).then(async (res) => {
    if(res && (res.ok || res.type === "opaque")) await cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  if(cached){
    event.waitUntil(update);
    return cached;
  }
  const res = await update;
  return res || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if(request.method !== "GET") return;
  let url;
  try{ url = new URL(request.url); }catch(e){ return; }
  if(url.protocol !== "http:" && url.protocol !== "https:") return;

  // dados e login: sempre direto na internet, sem interceptar
  if(isSupabaseApi(url)) return;

  if(request.mode === "navigate"){
    if(url.origin !== self.location.origin) return;
    event.respondWith(networkFirstPage(request));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const isLib = url.hostname === "cdn.jsdelivr.net" && url.pathname.indexOf("/npm/@supabase/") === 0;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  const isOwnAsset = sameOrigin && /\/(manifest\.json|icon-192\.png|icon-512\.png|index\.html)$/.test(url.pathname);

  if(isLib || isFont || isOwnAsset){
    event.respondWith(staleWhileRevalidate(event));
  }
});