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
  // postos de Pernambuco "da semana passada": tamanhos antigos e o 1º posto de Petrolina a R$ 1,23
  "dados/postos/PE.json": o => { o.tamanhos = [1, 2]; o.periodo.ate = "2026-10-30"; o.gerado_em = "2026-11-01T00:00-03:00";
    for (const p of o.cidades.PETROLINA) if (p.p.gasolina) p.p.gasolina = [1.23, "2026-10-30"]; return o; },
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
    CapacitorHttp: { request: o => window.__http(o.url, o.responseType, o.headers || {}) },
    Share: { share: reg("Share", "share") },
    Browser: { open: reg("Browser", "open") },
    App: { addListener: (ev, cb) => { window.__voltar = cb; }, getInfo: () => Promise.resolve({ build: "1" }) },
    CapacitorUpdater: { notifyAppReady: reg("Upd", "ready"), list: () => Promise.resolve({ bundles: [] }),
      download: a => { window.__chamadas.push(["Upd", "download", a]); return Promise.resolve({ id: "b" + a.version }); }, next: reg("Upd", "next") },
    Gasolina: { podeInstalar: () => Promise.resolve({ pode: true }), abrirPermissaoInstalar: reg("Gasolina", "permissao"), instalarAtualizacao: reg("Gasolina", "instalar") },
    LocalNotifications: { checkPermissions: () => Promise.resolve({ display: "granted" }), requestPermissions: reg("LN", "req"),
      getPending: () => Promise.resolve({ notifications: [] }), cancel: reg("LN", "cancel"), schedule: reg("LN", "schedule") } } };`;

let semInternet = false;
const baixados = [];
async function httpNativo(url, tipo, extras = {}) {
  if (semInternet) throw new Error("Unable to resolve host");
  baixados.push([url, extras.Range || ""]);
  const r = await fetch(url, { headers: { "User-Agent": AGENTE, "Accept-Language": "pt-BR,pt;q=0.9", ...(extras.Range ? { Range: extras.Range } : {}) }, signal: AbortSignal.timeout(180000) });
  const ct = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  let data;
  if (ct.includes("application/json")) { try { data = JSON.parse(buf.toString("utf8")); } catch (e) { data = buf.toString("utf8"); } }  // como o Capacitor faz
  else data = tipo === "arraybuffer" ? buf.toString("base64") : buf.toString("utf8");
  return { status: r.status, data, headers: Object.fromEntries(r.headers) };
}

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const nav = await chromium.launch();
  const falhas = [];
  const ctx = await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(REMOTO + "**", rt => rt.fulfill({ status: 404, body: "" }));        // site NÃO publicado
  await ctx.route("https://raw.githubusercontent.com/**", rt => rt.fulfill({ status: 404, body: "" }));
  // GitHub de mentira: 1.8 só troca telas (serve para o APK 1); 1.9 exige APK novo
  const URL_GH = "https://github.com/pimentel-code/gasolina/releases/download/";
  const rel = (n, nativo) => ({ tag_name: "v1." + n, prerelease: false, draft: false, body: "Novidade " + n + "\n\n[nativo:" + nativo + "]",
    assets: [{ name: "miolo.zip", browser_download_url: URL_GH + "v1." + n + "/miolo.zip" }, { name: "Gasolina.apk", browser_download_url: URL_GH + "v1." + n + "/Gasolina.apk" }] });
  await ctx.route("https://api.github.com/repos/pimentel-code/gasolina/releases**", rt => rt.fulfill({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([rel(9, 9), rel(8, 1)]) }));
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
  if (!/✓ Atualizado agora/.test(st)) falhas.push("1: atualização não terminou bem: " + st + " | " + await pg.evaluate(() => JSON.stringify([...document.querySelectorAll("#fontes li")].map(x => x.textContent.replace(/\s+/g, " ")).slice(0, 8))));
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

  // postos: mostra o que veio no APK (R$ 1,23) e busca sozinho a planilha nova na ANP
  await pg.click(".abas button[data-aba='postos']");
  await pg.waitForSelector("#postos li.posto", { timeout: 20000 }).catch(() => { });
  const t1 = Date.now();
  await pg.waitForFunction(() => { const b = document.querySelector("#postos li.posto .valor b"); return b && !/1,23/.test(b.textContent); }, null, { timeout: 240000 })
    .catch(() => falhas.push("postos: o celular não trocou os preços velhos (R$ 1,23) pelos da ANP: " + JSON.stringify(baixados.filter(b => /postos|qus/.test(b[0])))));
  const pp = await pg.textContent("#postos li.posto .valor b").catch(() => "");
  const anp = baixados.filter(b => /qus\//.test(b[0]));
  console.log(`  postos: ${((Date.now() - t1) / 1000).toFixed(1)} s → 1º posto ${pp}; pedidos à ANP: ${anp.map(b => b[1] ? "1 byte" : "planilha").join(", ")}`);
  if (!anp.some(b => b[1] === "bytes=0-0")) falhas.push("postos: não conferiu o tamanho antes de baixar");
  await pg.screenshot({ path: `${SAIDA}/apk-postos.png` });
  // 2ª vez no mesmo dia: não baixa de novo
  const antes = baixados.length;
  await pg.evaluate(() => Nativo.atualizarPostos("PE")).catch(() => { });
  if (baixados.slice(antes).some(b => /qus\//.test(b[0]) && !b[1])) falhas.push("postos: baixou a planilha de novo sem precisar");
  await pg.click(".abas button[data-aba='resumo']"); await pg.waitForTimeout(200);

  // compartilhar sem site no ar: só texto
  await pg.click("#bt-compartilhar"); await pg.waitForTimeout(300);
  const sh = (await pg.evaluate(() => __chamadas)).find(c => c[0] === "Share");
  if (!sh || sh[2].url) falhas.push("compartilhar: mandou link que não funciona (site fora do ar): " + JSON.stringify(sh));
  await pg.click(".abas button[data-aba='agenda']"); await pg.waitForTimeout(300);
  const ln = await pg.$("#noticias a");
  if (ln) { await ln.click(); if (!(await pg.evaluate(() => __chamadas)).some(c => c[0] === "Browser")) falhas.push("notícia não abriu no navegador do celular"); }
  await pg.check("#ch-lembretes"); await pg.waitForTimeout(300);
  if (!(await pg.evaluate(() => __chamadas)).some(c => c[0] === "LN" && c[1] === "schedule")) falhas.push("lembretes não foram agendados");

  // 2) fecha e abre de novo SEM internet: continua com os dados que o celular buscou
  await pg.click(".abas button[data-aba='resumo']"); await pg.waitForTimeout(200);
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

  // 3) atualização do app, como no Prumo: telas novas baixadas sozinhas; APK novo com o botão Atualizar
  semInternet = false;
  await pg.evaluate(() => { localStorage.removeItem("gasolina.atualizacao.conferido"); return window.AtualizarApp.conferir(true); });
  await pg.waitForTimeout(500);
  const ch3 = await pg.evaluate(() => __chamadas);
  const dl = ch3.find(c => c[0] === "Upd" && c[1] === "download");
  if (!dl || dl[2].version !== "8") falhas.push("atualização: não baixou o miolo 1.8 sozinho: " + JSON.stringify(dl));
  if (!ch3.some(c => c[0] === "Upd" && c[1] === "next")) falhas.push("atualização: não deixou o miolo marcado para a próxima abertura");
  if (!ch3.some(c => c[0] === "Upd" && c[1] === "ready")) falhas.push("atualização: não avisou que o miolo abriu bem (voltaria ao anterior)");
  if (await pg.isHidden("#nova-versao")) falhas.push("atualização: a faixa da versão 1.9 (APK novo) não apareceu");
  else {
    await pg.click("#nova-versao [data-acao='atualizar-app']"); await pg.waitForTimeout(400);
    const ins = (await pg.evaluate(() => __chamadas)).find(c => c[0] === "Gasolina" && c[1] === "instalar");
    if (!ins || !/v1\.9\/Gasolina\.apk$/.test(ins[2].url)) falhas.push("atualização: Atualizar não baixou o APK 1.9: " + JSON.stringify(ins));
    else console.log("  ✓ atualização: miolo 1.8 baixado sozinho; faixa da 1.9 → Atualizar baixa o APK e abre o instalador");
  }
  await pg.click(".abas button[data-aba='sobre']"); await pg.waitForTimeout(200);
  if (await pg.isHidden("#cartao-atualizacoes")) falhas.push("atualização: cartão de atualizações não apareceu no Sobre");
  await pg.screenshot({ path: `${SAIDA}/apk-atualizacao.png`, fullPage: true });

  await nav.close(); srv.close();
  if (falhas.length) { console.log("FALHAS:\n - " + falhas.join("\n - ")); process.exit(1); }
  console.log("Tudo certo: o app Android atualiza sozinho pelas fontes e funciona sem internet.");
})();
