// Testa o app Android simulando o Capacitor num navegador de verdade, com INTERNET DE VERDADE:
// o "celular" busca nas fontes (ANP, Banco Central, Ipeadata, notícias) e recalcula tudo sozinho.
// Roda sobre a pasta www/ (a mesma que vai dentro do APK). Uso: ./copiar-www.sh && node testes/apk.js
//
// Para provar que o celular busca mesmo, o "APK" do teste vem com dados ATRASADOS uma semana
// (a última semana é apagada da base e o preço embutido é trocado por R$ 1,11).
const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require(path.join(process.env.HOME, "Projetos/Sistemas/Prumo/node_modules/playwright"));
const WWW = path.join(__dirname, "..", "www");
const SAIDA = process.env.FOTOS || "/tmp";
const REMOTO = "https://pimentel-code.github.io/gasolina/";
const AGENTE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36";

// --- "APK" atrasado uma semana
const lerW = f => JSON.parse(fs.readFileSync(path.join(WWW, f)));
const ULT = Object.keys(lerW("base/precos_brasil.json")).sort().pop();
const atrasar = {
  "base/precos_brasil.json": o => { delete o[ULT]; return o; },
  "base/precos_ufs.json": o => { for (const s of Object.values(o)) delete s[ULT]; return o; },
  "base/precos_municipios.json": o => { for (const s of Object.values(o)) delete s[ULT]; return o; },
  "base/detalhe_ultima_semana.json": () => ({}),
  "base/controle.json": o => ({ ...o, ultima_execucao: "2026-11-01T00:00-03:00" }),
  "dados/painel.json": o => { o.brasil.preco = 1.11; o.gerado_em = "2026-11-01T00:00-03:00"; return o; },
};
const tipos = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split("?")[0]).replace(/^\//, "").replace(/(^|\/)$/, "$1index.html");
  const f = path.join(WWW, rel);
  if (!f.startsWith(WWW) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": tipos[path.extname(f)] || "application/octet-stream" });
  if (atrasar[rel]) return r.end(JSON.stringify(atrasar[rel](lerW(rel))));
  fs.createReadStream(f).pipe(r);
});

// Capacitor de mentira: registra o que o app pediu; o HTTP nativo é feito pelo Node (internet real)
const FALSO = `
  window.__chamadas = [];
  const reg = (p, m) => a => { window.__chamadas.push([p, m, a]); return Promise.resolve({}); };
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    CapacitorHttp: { request: o => window.__http(o.url, o.responseType) },
    Share: { share: reg("Share", "share") },
    Browser: { open: reg("Browser", "open") },
    App: { addListener: (ev, cb) => { window.__voltar = cb; } },
    LocalNotifications: { checkPermissions: () => Promise.resolve({ display: "granted" }), requestPermissions: reg("LN", "req"),
      getPending: () => Promise.resolve({ notifications: [] }), cancel: reg("LN", "cancel"), schedule: reg("LN", "schedule") } } };`;

let semInternet = false;
async function httpNativo(url, tipo) {
  if (semInternet) throw new Error("Unable to resolve host");
  const r = await fetch(url, { headers: { "User-Agent": AGENTE, "Accept-Language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(90000) });
  const ct = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  let data;
  if (ct.includes("application/json")) { try { data = JSON.parse(buf.toString("utf8")); } catch (e) { data = buf.toString("utf8"); } }  // como o Capacitor faz
  else data = tipo === "arraybuffer" ? buf.toString("base64") : buf.toString("utf8");
  return { status: r.status, data, headers: {} };
}

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const nav = await chromium.launch();
  const falhas = [];
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(REMOTO + "**", rt => rt.fulfill({ status: 404, body: "" }));        // site NÃO publicado
  await ctx.route("https://raw.githubusercontent.com/**", rt => rt.fulfill({ status: 404, body: "" }));
  await ctx.exposeFunction("__http", httpNativo);
  await ctx.addInitScript(FALSO);
  const pg = await ctx.newPage();
  pg.on("pageerror", e => falhas.push(`ERRO JS ${e.message}`));
  // (os 404 do site e do GitHub são de propósito: simulam o projeto ainda não publicado)
  pg.on("console", m => { if (m.type() === "error" && !/pimentel-code\.github\.io|raw\.githubusercontent/.test(m.location().url || "")) falhas.push(`console: ${m.text()} ${m.location().url}`); });

  // 1) primeira abertura, com internet: mostra o que veio no APK e atualiza sozinho
  await pg.goto(BASE, { waitUntil: "load" });
  await pg.waitForSelector("#preco");
  await pg.waitForTimeout(400);
  if (!/1,11/.test(await pg.textContent("#preco"))) falhas.push("1: não mostrou primeiro os dados do APK");
  if (!/vieram junto com o app/.test(await pg.textContent("#frescor"))) falhas.push("1: não avisou que os dados vieram com o app");
  if (await pg.isHidden("#atualizacao")) falhas.push("1: botão Atualizar não apareceu");
  const t0 = Date.now();
  await pg.waitForFunction(() => /Atualizado|não respondeu|Não consegui|Sem internet/.test(document.querySelector("#atualizacao-txt").textContent), null, { timeout: 240000 });
  const st = await pg.textContent("#atualizacao-txt");
  console.log(`  1ª atualização no "celular": ${((Date.now() - t0) / 1000).toFixed(1)} s → ${st}`);
  if (!/✓ Atualizado agora/.test(st)) falhas.push("1: atualização não terminou bem: " + st + " | " + await pg.evaluate(() => JSON.stringify([...document.querySelectorAll("#fontes tr")].map(x => x.textContent.replace(/\s+/g, " ")).slice(0, 8))));
  const preco = await pg.textContent("#preco"), fr = await pg.textContent("#frescor");
  if (/1,11/.test(preco)) falhas.push("1: o preço não mudou depois de atualizar");
  const semana = ULT.split("-").reverse().join("/");
  if (!fr.includes(semana)) falhas.push(`1: a semana ${semana} não apareceu depois de atualizar: ${fr}`);
  else console.log(`  ✓ o celular buscou a semana até ${semana} sozinho: Brasil ${preco.trim()}`);
  await pg.screenshot({ path: `${SAIDA}/apk-atualizado.png` });

  // cidade e gráficos depois da atualização
  await pg.fill("#busca", "petrol"); await pg.waitForTimeout(300);
  await pg.press("#busca", "Enter"); await pg.waitForTimeout(500);
  if (!/Petrolina/.test(await pg.textContent("#t-lugar"))) falhas.push("1: busca não abriu Petrolina: " + await pg.textContent("#t-lugar"));
  if (!/R\$/.test(await pg.textContent("#preco"))) falhas.push("1: preço da cidade não apareceu");

  // compartilhar sem site no ar: só texto
  await pg.click("#bt-compartilhar"); await pg.waitForTimeout(300);
  const sh = (await pg.evaluate(() => __chamadas)).find(c => c[0] === "Share");
  if (!sh || sh[2].url) falhas.push("compartilhar: mandou link que não funciona (site fora do ar): " + JSON.stringify(sh));
  const ln = await pg.$("#noticias a");
  if (ln) { await ln.click(); if (!(await pg.evaluate(() => __chamadas)).some(c => c[0] === "Browser")) falhas.push("notícia não abriu no navegador do celular"); }
  await pg.check("#ch-lembretes"); await pg.waitForTimeout(300);
  if (!(await pg.evaluate(() => __chamadas)).some(c => c[0] === "LN" && c[1] === "schedule")) falhas.push("lembretes não foram agendados");

  // 2) fecha e abre de novo SEM internet: continua com os dados que o celular buscou
  semInternet = true;
  await pg.reload({ waitUntil: "load" });
  await pg.waitForSelector("#preco"); await pg.waitForTimeout(600);
  if (/1,11/.test(await pg.textContent("#preco")) || /vieram junto/.test(await pg.textContent("#frescor"))) falhas.push("2: perdeu os dados atualizados ao reabrir");
  await pg.click("#bt-atualizar");
  await pg.waitForFunction(() => /Sem internet|Não consegui|Atualizado/.test(document.querySelector("#atualizacao-txt").textContent), null, { timeout: 120000 });
  const st2 = await pg.textContent("#atualizacao-txt");
  if (!/Sem internet agora/.test(st2)) falhas.push("2: sem internet, a mensagem ficou estranha: " + st2);
  if (!(await pg.textContent("#frescor")).includes(semana)) falhas.push("2: sem internet, perdeu a semana nova");
  console.log("  ✓ sem internet: " + st2);
  await pg.screenshot({ path: `${SAIDA}/apk-sem-internet.png` });

  await nav.close(); srv.close();
  if (falhas.length) { console.log("FALHAS:\n - " + falhas.join("\n - ")); process.exit(1); }
  console.log("Tudo certo: o app Android atualiza sozinho pelas fontes e funciona sem internet.");
})();
