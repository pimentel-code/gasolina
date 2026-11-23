// Prova de fumaça num navegador de verdade: abre o app, confere erros e tira fotos.
// Uso: node testes/tela.js [endereço]   (padrão: o Painel local)
const path = require("path");
const { chromium } = require(path.join(process.env.HOME, "Projetos/Sistemas/Prumo/node_modules/playwright"));
const URL_APP = process.argv[2] || "http://127.0.0.1:8100/pagina/gasolina/";
const SAIDA = process.env.FOTOS || "/tmp";
(async () => {
  const nav = await chromium.launch();
  const falhas = [];
  for (const [nome, vp, tema] of [["pc", { width: 1280, height: 900 }, "light"], ["celular", { width: 390, height: 844 }, "light"], ["celular-escuro", { width: 390, height: 844 }, "dark"]]) {
    const ctx = await nav.newContext({ viewport: vp, colorScheme: tema, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    pg.on("pageerror", e => falhas.push(`${nome}: ERRO JS ${e.message}`));
    pg.on("console", m => { if (m.type() === "error") falhas.push(`${nome}: console ${m.text()}`); });
    await pg.goto(URL_APP + (nome === "pc" ? "?local=PE/PETROLINA" : "?local=BA"), { waitUntil: "networkidle" });
    await pg.waitForTimeout(800);
    const preco = await pg.textContent("#preco");
    if (!/R\$/.test(preco)) falhas.push(`${nome}: preço não apareceu (${preco})`);
    const largura = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (largura > 1) falhas.push(`${nome}: página rola de lado (${largura}px)`);
    await pg.screenshot({ path: `${SAIDA}/gasolina-${nome}.png`, fullPage: true });
    if (nome === "pc") {
      await pg.fill("#busca", "petrol");
      await pg.waitForTimeout(200);
      const sug = await pg.textContent("#sugestoes");
      if (!/Petrolina/.test(sug)) falhas.push("busca não achou Petrolina: " + sug);
      await pg.click("#mapa button[data-lugar='SP']");
      await pg.waitForTimeout(300);
      if (!/São Paulo/.test(await pg.textContent("#t-lugar"))) falhas.push("clique no mapa não trocou o Estado");
    }
    await ctx.close();
  }
  await nav.close();
  if (falhas.length) { console.log("FALHAS:\n" + falhas.join("\n")); process.exit(1); }
  console.log("Tudo certo: 3 telas sem erro. Fotos em " + SAIDA);
})();
