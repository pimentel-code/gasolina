// Prova de fumaça num navegador de verdade: abre o app, passa pelas 6 abas, confere erros e tira fotos.
// Uso: node testes/tela.js [endereço]   (padrão: o Painel local)
const path = require("path");
const { chromium } = require(path.join(process.env.HOME, "Projetos/Sistemas/Prumo/node_modules/playwright"));
const URL_APP = process.argv[2] || "http://127.0.0.1:8100/pagina/gasolina/";
const SAIDA = process.env.FOTOS || "/tmp";
const ABAS = ["resumo", "postos", "porque", "estados", "agenda", "sobre"];
(async () => {
  const nav = await chromium.launch();
  const falhas = [];
  for (const [nome, vp, tema] of [["pc", { width: 1280, height: 900 }, "light"], ["celular", { width: 390, height: 844 }, "light"], ["celular-escuro", { width: 390, height: 844 }, "dark"], ["celular-pequeno", { width: 340, height: 700 }, "light"]]) {
    const ctx = await nav.newContext({ viewport: vp, colorScheme: tema, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    pg.on("pageerror", e => falhas.push(`${nome}: ERRO JS ${e.message}`));
    pg.on("console", m => { if (m.type() === "error") falhas.push(`${nome}: console ${m.text()}`); });
    await pg.goto(URL_APP + (nome === "pc" ? "?local=PE/PETROLINA" : "?local=BA"), { waitUntil: "networkidle" });
    await pg.waitForTimeout(800);
    const preco = await pg.textContent("#preco");
    if (!/R\$/.test(preco)) falhas.push(`${nome}: preço não apareceu (${preco})`);
    for (const aba of ABAS) {
      await pg.click(`.abas button[data-aba='${aba}']`);
      await pg.waitForTimeout(350);
      if (await pg.isHidden(`#aba-${aba}`)) falhas.push(`${nome}: aba ${aba} não abriu`);
      // abre todos os "Entenda" da aba (para conferir que cabem na tela)
      const bts = await pg.$$(`#aba-${aba} .bt-entenda`);
      for (const bt of bts) await bt.click();
      if (bts.length && (await pg.$$(`#aba-${aba} .painel-explica:not([hidden])`)).length !== bts.length) falhas.push(`${nome}/${aba}: algum "Entenda" não abriu`);
      if (aba === "sobre") for (const d of await pg.$$("#glossario summary")) await d.click();
      const largura = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (largura > 1) falhas.push(`${nome}/${aba}: página rola de lado (${largura}px)`);
      // nada pode passar da borda do cartão
      const vazou = await pg.evaluate(a => [...document.querySelectorAll(`#aba-${a} .cartao *`)].filter(e => {
        const c = e.closest(".cartao").getBoundingClientRect(), r = e.getBoundingClientRect();
        return r.width > 0 && !e.closest(".rolagem, .pilulas.rolar, .carrossel, .mapa-postos, .grafico svg, details:not([open])") && (r.right > c.right + 1 || r.left < c.left - 1);
      }).slice(0, 3).map(e => e.tagName + "." + e.className + ": " + (e.textContent || "").trim().slice(0, 40)), aba);
      if (vazou.length) falhas.push(`${nome}/${aba}: passa da borda do cartão: ${vazou.join(" | ")}`);
      if (nome.startsWith("celular") || aba === "resumo") await pg.screenshot({ path: `${SAIDA}/gasolina-${nome}-${aba}.png`, fullPage: true });
    }
    if (nome === "pc") {
      // postos de Petrolina: cartão no Resumo, lista, troca de combustível e "Como chegar"
      await pg.click(".abas button[data-aba='resumo']"); await pg.waitForTimeout(200);
      if (/mais barata em|Como chegar/.test(await pg.textContent("#aba-resumo"))) falhas.push("postos: o Resumo voltou a mostrar postos (ele pediu só na aba Postos)");
      await pg.click(".abas button[data-aba='postos']"); await pg.waitForTimeout(300);
      const nG = (await pg.$$("#postos li.posto")).length;
      if (nG < 3) falhas.push("postos: lista de gasolina com " + nG + " postos");
      const precos = await pg.$$eval("#postos li.posto .valor b", b => b.map(x => +x.textContent.replace(/[^\d,]/g, "").replace(",", ".")));
      if (precos.some((v, i) => i && v < precos[i - 1])) falhas.push("postos: lista fora de ordem: " + precos.join(" "));
      if (!/70%/.test(await pg.textContent("#postos-resumo"))) falhas.push("postos: faltou a conta etanol × gasolina");
      await pg.click("[data-comb='diesel_s10']"); await pg.waitForTimeout(200);
      if (!/Diesel S10/.test(await pg.textContent("#postos"))) { /* outros combustíveis aparecem na linha de baixo */ }
      const v1 = await pg.textContent("#postos li.posto .valor b");
      if (!/R\$/.test(v1)) falhas.push("postos: diesel S10 sem preço");
      const href = await pg.getAttribute("#postos li.posto a.rota", "href");
      if (!/google\.com\/maps\/(search\/.*Petrolina|dir\/\?api=1&destination=-9\.\d+,-40\.\d+)/i.test(decodeURIComponent(href))) falhas.push("postos: link do mapa estranho: " + href);
      await pg.click("[data-comb='gasolina']"); await pg.waitForTimeout(200);
      // mini mapa: etiquetas de preço, toque numa etiqueta acende o cartão; "perto de mim" com localização falsa
      await pg.waitForSelector("#mapa-postos .pino", { timeout: 20000 }).catch(async () => falhas.push("mapa: nenhuma etiqueta de preço apareceu (" + (await pg.textContent("#mapa-nota")) + ")"));
      const nPinos = (await pg.$$("#mapa-postos .pino")).length;
      const nCards = (await pg.$$("#carrossel .posto-card")).length;
      if (nCards !== nG && nCards < 10) falhas.push(`carrossel com ${nCards} cartões`);
      const pino = await pg.$("#mapa-postos .pino.barato");
      if (pino) {
        await pino.click(); await pg.waitForTimeout(500);
        const k = await pino.getAttribute("data-k");
        if (!(await pg.$(`#carrossel .posto-card.sel[data-k="${k.replace(/"/g, '\\"')}"]`))) falhas.push("mapa: tocar na etiqueta não acendeu o cartão");
      } else falhas.push("mapa: sem etiqueta verde (mais barato)");
      await pg.context().grantPermissions(["geolocation"]);
      await pg.context().setGeolocation({ latitude: -9.3891, longitude: -40.5027 });   // centro de Petrolina
      await pg.click("#bt-perto"); await pg.waitForTimeout(800);
      if (!/de você/.test(await pg.textContent("#carrossel"))) falhas.push("perto de mim: distância não apareceu");
      if (!/Mais perto de você/.test(await pg.textContent("#t-carrossel"))) falhas.push("perto de mim: não trocou para a ordem por distância");
      if (!(await pg.$("#mapa-postos .voce"))) falhas.push("perto de mim: o ponto azul não apareceu");
      await pg.fill("#busca-posto", "gene"); await pg.waitForTimeout(500);
      const nBusca = (await pg.$$("#postos li.posto")).length;
      if (!nBusca || nBusca >= nG) falhas.push("busca por nome não filtrou (" + nBusca + ")");
      await pg.screenshot({ path: `${SAIDA}/gasolina-pc-postos-mapa.png`, fullPage: true });
      await pg.fill("#busca-posto", ""); await pg.waitForTimeout(400);
      console.log(`  mapa: ${nPinos} etiquetas, ${nCards} cartões; busca "gene": ${nBusca} postos`);
      console.log(`  postos de Petrolina: ${nG} com gasolina, mais barato ${precos[0]}; diesel S10 a partir de ${v1}`);
      await pg.click(".abas button[data-aba='porque']"); await pg.waitForTimeout(200);
      if (!(await pg.$("#g-atual svg"))) falhas.push("gráfico não desenhou");
      await pg.click("[data-grafico='brent']"); await pg.waitForTimeout(200);
      if (!/Brent/.test(await pg.textContent("#g-atual"))) falhas.push("troca de gráfico não funcionou");
      await pg.fill("#busca", "petrol");
      await pg.waitForTimeout(200);
      const sug = await pg.textContent("#sugestoes");
      if (!/Petrolina/.test(sug)) falhas.push("busca não achou Petrolina: " + sug);
      await pg.fill("#busca", "");
      await pg.click(".abas button[data-aba='estados']"); await pg.waitForTimeout(200);
      await pg.click("#mapa button[data-lugar='SP']");
      await pg.waitForTimeout(300);
      if (!/São Paulo/.test(await pg.textContent("#t-lugar"))) falhas.push("clique no mapa não trocou o Estado");
      if (await pg.isHidden("#aba-resumo")) falhas.push("clique no mapa não voltou ao Resumo");
      // apagar um atalho lá em cima
      const antes = await pg.$$eval("#atalhos .chip", c => c.length);
      await pg.click("#atalhos [data-remover='SP']"); await pg.waitForTimeout(300);
      if (await pg.$("#atalhos [data-lugar='SP']")) falhas.push("o × não tirou São Paulo dos atalhos");
      if (!/Brasil/.test(await pg.textContent("#t-lugar"))) falhas.push("ao tirar o lugar aberto, não voltou para o Brasil");
      if (await pg.$("#atalhos [data-remover='BR']")) falhas.push("o Brasil não pode ter ×");
      await pg.reload({ waitUntil: "networkidle" }); await pg.waitForTimeout(500);
      if (await pg.$("#atalhos [data-lugar='SP']")) falhas.push("São Paulo voltou depois de recarregar");
      console.log(`  atalhos: ${antes} → ${await pg.$$eval("#atalhos .chip", c => c.length)} depois do ×`);
    }
    await ctx.close();
  }
  await nav.close();
  if (falhas.length) { console.log("FALHAS:\n" + falhas.join("\n")); process.exit(1); }
  console.log("Tudo certo: 4 telas × 6 abas sem erro. Fotos em " + SAIDA);
})();
