/* Funciona sem internet: guarda a tela e os últimos dados.
   Tela: do cache primeiro (troca de versão = muda VERSAO).
   Dados: da internet primeiro; sem rede, o último guardado. */
const VERSAO = "gasolina-v2";
const TELA = ["./", "index.html", "estilo.css", "app.js", "graficos.js", "nativo.js", "manifest.webmanifest", "icones/icone.svg", "icones/icone-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(TELA)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== "gasolina-dados").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.includes("/dados/")) {
    const chave = u.origin + u.pathname;          // ignora o ?v= de cache
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok) { const cp = r.clone(); caches.open("gasolina-dados").then(c => c.put(chave, cp)); }
        return r;
      }).catch(() => caches.open("gasolina-dados").then(c => c.match(chave)).then(r => r || Response.error()))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && u.pathname.match(/\.(js|css|svg|png|html)$/)) { const cp = resp.clone(); caches.open(VERSAO).then(c => c.put(e.request, cp)); }
    return resp;
  })));
});
