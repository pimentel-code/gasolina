/* Gasolina: vai subir ou cair? — tela do app (HTML/JS puro, sem bibliotecas). */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const semAcento = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const reais = (v, casas = 2) => v == null ? "—" : "R$\u00a0" + v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const sinal = (v, casas = 2) => v == null ? "—" : (v > 0.0049 ? "+" : v < -0.0049 ? "−" : "") + "R$\u00a0" + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const pct = (v, casas = 0) => v == null ? "—" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }) + "%";
  const pctSinal = v => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  const dataBR = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
  const dataCurtaBR = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  let P = null;          // painel.json
  let H = null;          // historico.json
  let M = null;          // municipios.json
  let lugar = "BR";
  let modoMapa = "previsao";
  let periodo = 52;
  let ordemTabela = { campo: "preco", desc: true };

  // ------------------------------------------------------------ carregar

  const NATIVO = !!(window.Nativo && Nativo.ativo);
  let origemDados = "celular";   // no app Android: "celular" = calculado no aparelho; "embutido" = veio com o APK

  async function buscarJSON(nome, tempo = 15000) {
    if (NATIVO) {
      const r = await Nativo.buscar(nome, tempo);
      if (nome === "painel.json") origemDados = r.origem;
      return r.dados;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), tempo);
    try {
      const r = await fetch(`dados/${nome}?v=${Math.floor(Date.now() / 600000)}`, { signal: ctrl.signal, cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function iniciar() {
    lerPreferencias();
    ligarControles();
    try {
      P = await buscarJSON("painel.json");
    } catch (e) {
      const arquivo = location.protocol === "file:";
      $("#frescor").innerHTML = arquivo
        ? "Este arquivo não abre com dois cliques. Abra pelo <b>Painel de Aplicativos</b> (ou digite <code>gasolina</code> no terminal)."
        : "Não consegui carregar os dados agora. Confira a internet e tente de novo em instantes.";
      return;
    }
    if (!P.ufs[lugar] && lugar !== "BR" && !lugar.includes("/")) lugar = "BR";
    desenharTudo();
    if (NATIVO) setTimeout(atualizarSePreciso, 300);
    buscarJSON("historico.json").then(d => { H = d; desenharGraficos(); }).catch(() => falhaParcial("g-preco"));
    buscarJSON("municipios.json").then(d => {
      M = d;
      if (lugar.includes("/")) desenharTudo();
    }).catch(() => { });
  }

  function falhaParcial(id) {
    const f = document.getElementById(id);
    if (f) f.innerHTML = '<p class="carregando">Não consegui carregar o histórico agora.</p>';
  }

  // ------------------------------------------------------------ lugar escolhido

  function dadosDoLugar() {
    if (lugar === "BR") return { tipo: "br", nome: "Brasil", a: P.brasil, uf: null };
    if (!lugar.includes("/")) {
      const a = P.ufs[lugar];
      return a ? { tipo: "uf", nome: a.nome, a, uf: lugar } : null;
    }
    if (!M) return { tipo: "carregando", nome: "Carregando cidade…", a: null, uf: lugar.split("/")[0] };
    const c = M.lista.find(x => x.id === lugar);
    if (!c) return null;
    return { tipo: "cidade", nome: `${c.nome} (${c.uf})`, a: c.a, uf: c.uf, cidade: c };
  }

  function escolher(id, rolar) {
    lugar = id;
    try {
      localStorage.setItem("gasolina.lugar", id);
      const rec = JSON.parse(localStorage.getItem("gasolina.recentes") || "[]").filter(x => x !== id);
      rec.unshift(id);
      localStorage.setItem("gasolina.recentes", JSON.stringify(rec.slice(0, 4)));
    } catch (e) { /* modo privado */ }
    const u = new URL(location.href);
    if (id === "BR") u.searchParams.delete("local"); else u.searchParams.set("local", id);
    history.replaceState(null, "", u);
    desenharTudo();
    if (rolar) $("#cartao-preco").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function lerPreferencias() {
    const q = new URLSearchParams(location.search).get("local");
    let guardado = null;
    try { guardado = localStorage.getItem("gasolina.lugar"); } catch (e) { }
    lugar = (q || guardado || "BR").toUpperCase();
    try {
      const t = localStorage.getItem("gasolina.tema");
      if (t) document.documentElement.dataset.tema = t;
    } catch (e) { }
  }

  function nomeCurto(id) {
    if (id === "BR") return "Brasil";
    if (!id.includes("/")) return P && P.ufs[id] ? P.ufs[id].nome : id;
    const c = M && M.lista.find(x => x.id === id);
    return c ? `${c.nome} (${c.uf})` : id.split("/")[1].toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  }

  // ------------------------------------------------------------ desenho geral

  function desenharTudo() {
    if (!P) return;
    const L = dadosDoLugar();
    if (!L) { lugar = "BR"; return desenharTudo(); }
    desenharFrescor();
    desenharAvisos();
    desenharAtalhos();
    desenharHeroi(L);
    desenharPrevisao(L);
    desenharConta(L);
    desenharPressao(L);
    desenharEventos(L);
    desenharMapa();
    desenharTabelaUFs();
    desenharComposicao();
    desenharNoticias();
    desenharMetodo();
    desenharFontes();
    if (H) desenharGraficos();
    document.title = `Gasolina em ${L.nome}: vai subir ou cair?`;
  }

  function desenharFrescor() {
    const g = new Date(P.gerado_em);
    const horas = (Date.now() - g.getTime()) / 36e5;
    const quando = g.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    let t = `Atualizado em ${quando} · preços da semana de ${dataCurtaBR(P.semana_inicio)} a ${dataBR(P.semana)} (a ANP publica uma vez por semana)`;
    if (NATIVO && origemDados === "embutido") t = "Dados que vieram junto com o app. " + t;
    if (horas > 36) t = `⚠ Os dados não são atualizados desde ${quando}. ` + t.replace(/^Atualizado em [^·]+· /, "");
    $("#frescor").textContent = t;
    $("#rodape-dados").innerHTML = `Dados: ANP (Levantamento de Preços e Síntese Semanal), Banco Central, EIA/Ipeadata, Yahoo Finance e Google Notícias. Última atualização: ${esc(quando)}.`;
  }

  function desenharAvisos() {
    const a = P.avisos || [];
    const box = $("#avisos");
    if (!a.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<details><summary>⚠ ${a.length === 1 ? "1 aviso" : a.length + " avisos"} sobre os dados</summary><ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>`;
  }

  function desenharAtalhos() {
    let rec = [];
    try { rec = JSON.parse(localStorage.getItem("gasolina.recentes") || "[]"); } catch (e) { }
    const ids = ["BR", ...rec.filter(x => x !== "BR")].slice(0, 5);
    $("#atalhos").innerHTML = ids.map(id => `<button type="button" data-lugar="${esc(id)}" aria-pressed="${id === lugar}">${esc(nomeCurto(id))}</button>`).join("");
  }

  // ------------------------------------------------------------ preço e previsão

  function desenharHeroi(L) {
    $("#t-lugar").textContent = L.tipo === "cidade" ? `Gasolina comum em ${L.nome}` : `Gasolina comum: ${L.nome}`;
    if (!L.a && L.tipo !== "cidade") {
      $("#preco").textContent = "…";
      $("#preco-detalhe").textContent = "";
      $("#preco-faixa").textContent = "";
      return;
    }
    const preco = L.a ? L.a.preco : L.cidade.p;
    $("#preco").innerHTML = `${esc(reais(preco))} <small>por litro</small>`;
    const v = L.a ? L.a.var_semana : null;
    $("#preco-detalhe").textContent = `Média da semana de ${dataCurtaBR(P.semana_inicio)} a ${dataBR(P.semana)}` +
      (v != null ? ` · ${Math.abs(v) < 0.005 ? "igual à semana anterior" : sinal(v) + " na semana"}` : "");
    const f = L.cidade ? L.cidade.faixa_precos : L.a && L.a.faixa_precos;
    $("#preco-faixa").textContent = f ? `Mais barato ${reais(f.min)} · mais caro ${reais(f.max)} · ${f.n} postos pesquisados` : "";
  }

  const TEXTO_VEREDITO = {
    sobe: ["⬆", "Chance de alta acima do normal"],
    desce: ["⬇", "Chance de queda acima do normal"],
    igual: ["➡", "Tende a ficar parado"],
    incerto: ["?", "Sem sinal claro"],
  };

  function desenharPrevisao(L) {
    const a = L.a;
    const seta = $("#prev-seta");
    if (!a) {
      seta.className = "seta"; seta.textContent = "·";
      $("#prev-texto").textContent = L.tipo === "carregando" ? "Carregando…" : "Poucos dados nesta cidade";
      $("#prev-valor").textContent = L.tipo === "cidade" ? "A ANP não pesquisa esta cidade toda semana; veja o Estado." : "";
      $("#prev-confianca").textContent = "";
      return;
    }
    const n = P.modelo.tabela.normal;
    let [s, txt] = TEXTO_VEREDITO[a.veredito] || TEXTO_VEREDITO.incerto;
    if (a.soma_eventos >= 0.05) txt = "Deve subir: tem aumento marcado";
    if (a.soma_eventos <= -0.05) txt = "Deve cair: tem redução marcada";
    seta.className = "seta " + (a.veredito === "sobe" ? "sobe" : a.veredito === "desce" ? "desce" : "");
    seta.textContent = s;
    $("#t-prev").textContent = `Próximas ${P.modelo.horizonte} semanas`;
    $("#prev-texto").textContent = txt;
    const ch = a.chances;
    let html = `<div class="segbarra" style="height:22px;margin:8px 0 4px" role="img" aria-label="Chance de subir ${pct(ch.sobe)}, de ficar parado ${pct(ch.igual)}, de cair ${pct(ch.desce)}">
      ${parte(ch.sobe, "var(--sobe)", "↑")}${parte(ch.igual, "var(--neutro)", "=", true)}${parte(ch.desce, "var(--desce)", "↓")}</div>
      Chance de <b>subir</b> mais de R$ 0,05: <b>${pct(ch.sobe)}</b> <span class="selo">normal ${pct(n.sobe)}</span> ·
      de <b>cair</b>: <b>${pct(ch.desce)}</b> <span class="selo">normal ${pct(n.desce)}</span>`;
    if (a.eventos && a.eventos.length) {
      html += `<div class="alerta">${a.eventos.map(e => `📅 ${esc(e.titulo)} (${dataCurtaBR(e.data)}): <b>${sinal(e.efeito)}</b> por litro`).join("<br>")}</div>`;
    }
    const an = anunciosDoLugar(L);
    if (an.length) {
      html += `<div class="alerta">📰 Manchete recente: <a href="${esc(an[0].link)}" target="_blank" rel="noopener">${esc(an[0].titulo)}</a>
        <br><small>${an[0].especulacao ? "Parece especulação, não anúncio. " : ""}Anúncios de refinaria costumam chegar à bomba em 1 a 3 semanas, nem sempre inteiros.</small></div>`;
    }
    $("#prev-valor").innerHTML = html;
    const t = P.modelo.teste_ultimo_ano;
    $("#prev-confianca").innerHTML = t && t.avisos_alta
      ? `Quanto confiar: nos últimos 12 meses, quando o app apontou chance maior de alta, o preço subiu em <b>${pct(t.avisos_alta_certos)}</b> das vezes (normal: ${pct(t.alta_normal)}). É um sinal fraco. O que mais move o preço são decisões com data, como as do calendário abaixo.`
      : "Quanto confiar: o sinal da conta é fraco. Veja o calendário: decisões com data movem mais o preço.";
  }

  function parte(v, cor, rotulo, escuro) {
    if (!v || v < 0.01) return "";
    const txt = v >= 0.12 ? `${rotulo} ${pct(v)}` : "";
    const nome = { "↑": "Sobe", "=": "Fica igual", "↓": "Cai" }[rotulo];
    return `<div style="flex:${v};background:${cor};${escuro ? "color:var(--tinta)" : ""}" title="${nome}: ${pct(v)}">${txt}</div>`;
  }

  function anunciosDoLugar(L) {
    const priv = /ACELEN|MATARIPE/i, ream = /\bREAM\b|AMAZ[ÔO]NIA/i;
    return (P.anuncios || []).filter(n => {
      if (priv.test(n.titulo)) return ["BA", "SE", "AL"].includes(L.uf);
      if (ream.test(n.titulo)) return ["AM", "RR", "AC", "RO"].includes(L.uf);
      return true;
    });
  }

  // ------------------------------------------------------------ a conta

  function desenharConta(L) {
    const a = L.a;
    const box = $("#conta");
    if (!a) { box.innerHTML = '<p class="carregando">Sem dados suficientes para a conta neste lugar.</p>'; return; }
    const c = a.custos_mudaram;
    const totalCustos = c.gasolina_a + c.anidro + c.federais + c.icms;
    const linhas = [
      ["Gasolina A (refinarias e importadores)", "68% do litro", c.gasolina_a],
      ["Etanol anidro", "32% do litro (mistura E32)", c.anidro],
      ["Impostos federais", "PIS/Cofins e Cide", c.federais],
      ["ICMS", "imposto estadual, igual em todo o país", c.icms],
    ];
    const escala = Math.max(0.25, ...linhas.map(l => Math.abs(l[2])), Math.abs(totalCustos), Math.abs(a.ja_repassado), Math.abs(a.falta_repassar));
    const barra = v => {
      const w = Math.min(50, Math.abs(v) / escala * 50);
      return `<div class="barra" aria-hidden="true"><i class="${v >= 0 ? "pos" : "neg"}" style="width:${w}%"></i></div>`;
    };
    const item = (nome, desc, v, cls = "") => `<div class="item ${cls}"><div class="nome"><b>${esc(nome)}</b><span>${esc(desc)}</span></div>${barra(v)}<div class="valor">${sinal(v)}</div></div>`;
    const ch = a.chances;
    const faixa = P.modelo.tabela.faixas[ch.faixa];
    box.innerHTML =
      `<p class="nota" style="margin-top:0">Quanto cada custo mudou: média das últimas ${P.modelo.suave} semanas comparada com a média de ${P.modelo.ref[0]} a ${P.modelo.ref[1]} semanas atrás, por litro na bomba.</p>` +
      linhas.map(l => item(...l)).join("") +
      `<div class="sep"></div>` +
      item("Os custos mudaram, no total", "soma das linhas acima", totalCustos) +
      item(`Os postos ${L.tipo === "br" ? "do país" : L.tipo === "cidade" ? "da cidade" : "do Estado"} já mudaram o preço em`, "isso já foi repassado", a.ja_repassado) +
      item("Falta repassar", faixa ? `situação: ${faixa.nome}` : "", a.falta_repassar, "total") +
      `<p class="nota">Desde 2024, em ${faixa ? faixa.casos.toLocaleString("pt-BR") : "—"} semanas de Estados com a conta nessa faixa, o preço
       <b>subiu</b> em ${pct(faixa && faixa.sobe)}, <b>caiu</b> em ${pct(faixa && faixa.desce)} e <b>ficou parado</b> em ${pct(faixa && faixa.igual)} das vezes nas ${P.modelo.horizonte} semanas seguintes.
       ${L.tipo === "cidade" ? "Na cidade a conta usa os custos do Brasil e o preço da própria cidade." : ""}</p>` +
      (a.semana_custo !== a.semana ? `<p class="nota">Os custos desta semana ainda não saíram; usei os da semana até ${dataBR(a.semana_custo)}.</p>` : "");
  }

  // ------------------------------------------------------------ pressão e calendário

  function desenharPressao(L) {
    const p = P.pressao, m = P.mercado;
    let html = "";
    if (p) {
      const d = p.defasagem;
      const w = Math.min(50, Math.abs(d) / 0.5 * 50);
      html += `<p style="margin:0">O preço médio da gasolina A no Brasil (${reais(p.realizacao)}) está
        <b>${pct(Math.abs(d))} ${d < 0 ? "abaixo" : "acima"}</b> do custo de importar (≈ ${reais(p.ppi_estimado)}).</p>
        <div class="medidor" role="img" aria-label="Diferença para o preço de importação: ${pctSinal(d)}">
          <i style="${d < 0 ? `right:50%;width:${w}%;background:var(--sobe)` : `left:50%;width:${w}%;background:var(--desce)`}"></i><span class="zero"></span></div>
        <div class="escala"><span>−50% (pressão para subir)</span><span>0</span><span>+50% (espaço para cair)</span></div>
        <p class="nota">${d < -0.1 ? "Muito abaixo: aumenta a chance de a Petrobras reajustar para cima e de faltar gasolina importada (o importador não compra no prejuízo)." :
          d > 0.05 ? "Acima: há espaço para redução nas refinarias." : "Perto do equilíbrio: pouca pressão vinda de fora."}
          PPI da ANP de ${dataBR(p.data_ppi)}${p.data_estimativa > p.data_ppi ? `, corrigido até ${dataBR(p.data_estimativa)} pelo petróleo e pelo dólar` : ""}.</p>`;
    }
    const li = (nome, x, fmt) => x ? `<li><span>${nome} <small class="selo">${dataCurtaBR(x.data)}</small></span><span>${fmt(x.valor)} · 7 dias ${pctSinal(x.var7)} · 30 dias ${pctSinal(x.var30)}</span></li>` : "";
    html += `<ul class="lista-simples">
      ${li("Petróleo Brent", m.brent, v => "US$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
      ${li("Dólar", m.dolar, v => reais(v, 3))}
      ${li("Etanol anidro (SP)", m.anidro, v => reais(v))}
      ${li("Gasolina A (média)", m.realizacao, v => reais(v))}
    </ul>`;
    if (L.uf && P.ufs[L.uf] && P.ufs[L.uf].refinaria_privada) {
      html += `<p class="alerta">🏭 ${esc(P.ufs[L.uf].nome)} recebe boa parte da gasolina de refinaria privada (${esc(P.ufs[L.uf].refinaria_privada)}),
        que acompanha o mercado internacional de perto: aqui o petróleo e o dólar chegam mais rápido à bomba, para cima e para baixo.</p>`;
    }
    $("#pressao").innerHTML = html;
  }

  const STATUS = {
    confirmado: ["Confirmado", "var(--ok)"],
    depende: ["Pode mudar", "var(--atencao)"],
    aconteceu: ["Já aconteceu", "var(--mudo)"],
    cancelado: ["Cancelado", "var(--mudo)"],
  };

  function desenharEventos(L) {
    const preco = L.a ? L.a.preco : (L.cidade && L.cidade.p);
    const lista = P.eventos.filter(e => e.dias > -45);
    $("#eventos").innerHTML = lista.map(e => {
      const [st, cor] = e.verificar ? ["Conferir!", "var(--critico)"] : (STATUS[e.status] || STATUS.depende);
      const d = e.data;
      const quando = e.andamento ? "acontecendo agora" : e.dias > 1 ? `faltam ${e.dias} dias` : e.dias === 1 ? "amanhã" : e.dias === 0 ? "hoje" : `há ${-e.dias} dias`;
      const efeito = e.efeito ? `<span class="selo">${sinal(e.efeito)}/L${e.status === "depende" ? " se acontecer" : ""}</span>` : "";
      const cenario = e.efeito && preco && e.dias >= 0 && e.status !== "aconteceu"
        ? `<div class="nota">Em ${esc(L.nome)}: ${reais(preco)} → <b>${reais(preco + e.efeito)}</b> (se o resto ficar igual).</div>` : "";
      const nots = (e.noticias || []).map(n => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.titulo)}</a> <small>(${esc(n.fonte)})</small></li>`).join("");
      return `<li class="${e.status === "aconteceu" ? "passou" : ""}">
        <div class="dia">${d.slice(8, 10)}<small>${MESES[+d.slice(5, 7) - 1]}/${d.slice(2, 4)}</small></div>
        <div><div class="tit">${esc(e.titulo)}</div>
          <div class="meta"><span class="selo"><i style="width:8px;height:8px;border-radius:50%;background:${cor};display:inline-block"></i>${st}</span>${efeito}<span class="selo">${quando}</span></div>
          ${cenario}
          ${e.noticia_alerta ? `<div class="alerta">📰 Saiu notícia que pode mudar este evento — confira:<ul style="margin:4px 0 0;padding-left:18px">${nots}</ul></div>` : ""}
          <details><summary>Entenda</summary>${esc(e.explicacao)} ${e.fonte ? `<a href="${esc(e.fonte)}" target="_blank" rel="noopener">Fonte</a>` : ""}
          ${!e.noticia_alerta && nots ? `<ul style="margin:4px 0 0;padding-left:18px">${nots}</ul>` : ""}</details>
        </div></li>`;
    }).join("") || "<li>Nenhum evento no calendário.</li>";
  }

  // ------------------------------------------------------------ mapa

  const GRADE = {
    RR: [0, 1], AP: [0, 2], AM: [1, 1], PA: [1, 2], MA: [1, 3], CE: [1, 4], RN: [1, 5],
    AC: [2, 0], RO: [2, 1], TO: [2, 2], PI: [2, 3], PE: [2, 4], PB: [2, 5],
    MT: [3, 1], GO: [3, 2], BA: [3, 3], SE: [3, 4], AL: [3, 5],
    MS: [4, 1], DF: [4, 2], MG: [4, 3], ES: [4, 4],
    PR: [5, 1], SP: [5, 2], RJ: [5, 3], SC: [6, 1], RS: [7, 1],
  };
  // rampas (azul sequencial; divergente vermelho-cinza-azul)
  const SEQ = ["#cde2fb", "#9ec5f4", "#5598e7", "#256abf", "#104281"];
  const DIV = ["#2a78d6", "#9ec5f4", "NEUTRO", "#f3a3a2", "#e34948"];
  const textoSobre = hex => {
    if (!hex.startsWith("#")) return "var(--tinta)";
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const L = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2] > 0.36 ? "#0b0b0b" : "#ffffff";
  };

  function corUF(uf) {
    const a = P.ufs[uf];
    if (!a) return { fundo: "var(--neutro)", texto: "var(--tinta)" };
    if (modoMapa === "preco") {
      const ps = Object.values(P.ufs).map(x => x.preco).sort((x, y) => x - y);
      const q = ps.filter(v => v < a.preco).length / ps.length;
      const f = SEQ[Math.min(4, Math.floor(q * 5))];
      return { fundo: f, texto: textoSobre(f) };
    }
    const d = (a.chances.sobe - P.modelo.tabela.normal.sobe) - (a.chances.desce - P.modelo.tabela.normal.desce) + (a.soma_eventos || 0) * 2;
    const i = d > 0.15 ? 4 : d > 0.05 ? 3 : d < -0.15 ? 0 : d < -0.05 ? 1 : 2;
    const f = DIV[i];
    return f === "NEUTRO" ? { fundo: "var(--neutro)", texto: "var(--tinta)" } : { fundo: f, texto: textoSobre(f) };
  }

  function desenharMapa() {
    const box = $("#mapa");
    const atual = lugar.split("/")[0];
    box.style.gridTemplateRows = "repeat(8, auto)";
    box.innerHTML = Object.entries(GRADE).map(([uf, [l, c]]) => {
      const a = P.ufs[uf];
      const { fundo, texto } = corUF(uf);
      const seta = a ? { sobe: "↑", desce: "↓", igual: "→", incerto: "·" }[a.veredito] : "";
      const rot = a ? `${a.nome}: ${reais(a.preco)}, ${TEXTO_VEREDITO[a.veredito][1].toLowerCase()}` : uf;
      return `<button type="button" data-lugar="${uf}" class="${uf === atual ? "atual" : ""}" style="grid-row:${l + 1};grid-column:${c + 1};background:${fundo};color:${texto}" aria-label="${esc(rot)}" title="${esc(rot)}">
        <b>${uf}</b><span>${a ? (modoMapa === "preco" ? a.preco.toFixed(2).replace(".", ",") : seta + " " + pct(a.chances.sobe)) : ""}</span></button>`;
    }).join("");
    const leg = $("#mapa-legenda");
    if (modoMapa === "preco") {
      const ps = Object.values(P.ufs).map(x => x.preco);
      leg.innerHTML = `<b>Preço médio da gasolina comum</b>
        <div class="rampa" style="background:linear-gradient(90deg,${SEQ.join(",")})"></div>
        <div class="escala"><span>${reais(Math.min(...ps))}</span><span>${reais(Math.max(...ps))}</span></div>
        <p class="nota">Mais escuro = mais caro. Com o ICMS igual em todo o país, a diferença vem do frete, da distância da refinaria e da concorrência entre postos.</p>`;
    } else {
      leg.innerHTML = `<b>Chance de alta comparada com o normal</b>
        <div class="chaves">
          <span class="chave"><i style="background:#e34948"></i>bem maior</span>
          <span class="chave"><i style="background:#f3a3a2"></i>maior</span>
          <span class="chave"><i style="background:var(--neutro)"></i>normal</span>
          <span class="chave"><i style="background:#9ec5f4"></i>menor (chance de queda)</span>
          <span class="chave"><i style="background:#2a78d6"></i>bem menor</span>
        </div>
        <p class="nota">O número em cada Estado é a chance de subir mais de R$ 0,05 em ${P.modelo.horizonte} semanas (normal: ${pct(P.modelo.tabela.normal.sobe)}). Toque num Estado para ver os motivos.</p>`;
    }
  }

  function desenharTabelaUFs() {
    const campos = [
      ["nome", "Estado", false], ["preco", "Preço", true], ["var_semana", "Na semana", true],
      ["sobe", "Chance de alta", true], ["desce", "Chance de queda", true], ["falta_repassar", "Falta repassar", true],
    ];
    const val = (a, c) => c === "sobe" || c === "desce" ? a.chances[c] : a[c];
    const linhas = Object.entries(P.ufs).sort((x, y) => {
      const a = val(x[1], ordemTabela.campo), b = val(y[1], ordemTabela.campo);
      const r = typeof a === "string" ? a.localeCompare(b, "pt-BR") : a - b;
      return ordemTabela.desc ? -r : r;
    });
    $("#tabela-ufs").innerHTML = `<table><caption class="nota" style="text-align:left">Toque no nome da coluna para ordenar; toque na linha para ver o Estado.</caption>
      <thead><tr>${campos.map(([c, n, num]) => `<th class="${num ? "num" : ""}" aria-sort="${ordemTabela.campo === c ? (ordemTabela.desc ? "descending" : "ascending") : "none"}"><button type="button" data-ordem="${c}">${n}${ordemTabela.campo === c ? (ordemTabela.desc ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead>
      <tbody>${linhas.map(([uf, a]) => `<tr data-lugar="${uf}" tabindex="0"><td>${esc(a.nome)} (${uf})</td><td class="num">${reais(a.preco)}</td><td class="num">${sinal(a.var_semana)}</td>
        <td class="num">${pct(a.chances.sobe)}</td><td class="num">${pct(a.chances.desce)}</td><td class="num">${sinal(a.falta_repassar)}</td></tr>`).join("")}</tbody></table>`;
  }

  // ------------------------------------------------------------ composição

  function desenharComposicao() {
    const c = P.composicao;
    const partes = [
      ["Gasolina A", "refinarias e importadores", c.gasolina_a, "--c1", false],
      ["Etanol anidro", "usinas (32% da mistura)", c.anidro, "--c2", false],
      ["Impostos federais", "PIS/Cofins e Cide", c.federais, "--c3", false],
      ["ICMS", "imposto estadual (igual no país)", c.icms, "--c4", true],
      ["Distribuição e posto", "margens, frete e custos", c.margens, "--c5", false],
    ];
    const tot = c.total;
    $("#composicao").innerHTML =
      `<div class="segbarra" role="img" aria-label="${partes.map(p => `${p[0]} ${reais(p[2])}`).join(", ")}">
        ${partes.filter(p => p[2] > 0).map(p => {
          const sh = p[2] / tot;
          return `<div class="${p[4] ? "escura" : ""}" style="flex:${p[2]};background:var(${p[3]})" title="${p[0]}: ${reais(p[2])} (${pct(sh)})">${sh >= 0.09 ? pct(sh) : ""}</div>`;
        }).join("")}</div>
      <div class="legenda-comp">${partes.map(p => `<div><i style="background:var(${p[3]})"></i><span>${p[0]}<small>${p[1]}</small></span><b>${reais(p[2])}</b></div>`).join("")}</div>
      <p class="nota">Total ${reais(tot)} por litro · semana até ${dataBR(P.composicao_semana)} · fonte: Síntese Semanal da ANP.</p>`;
  }

  // ------------------------------------------------------------ gráficos

  function recorte(d, v, semanas) {
    if (!semanas) return { d, v };
    const ini = new Date(Date.now() - semanas * 7 * 864e5).toISOString().slice(0, 10);
    const i = d.findIndex(x => x >= ini);
    return i < 0 ? { d: [], v: [] } : { d: d.slice(i), v: v.slice(i) };
  }

  function desenharGraficos() {
    if (!H || !P) return;
    const c1 = cssVar("--s1"), c2 = cssVar("--s2");
    const L = dadosDoLugar() || { tipo: "br" };
    const seriesPreco = [];
    if (L.tipo === "uf") seriesPreco.push({ nome: L.nome, cor: c1, ...recorte(H.semanas, H.ufs[L.uf], periodo) });
    if (L.tipo === "cidade" && M) seriesPreco.push({ nome: L.cidade.nome, cor: c1, ...recorte(M.semanas, L.cidade.serie, periodo) });
    seriesPreco.push({ nome: "Brasil", cor: L.tipo === "br" ? c1 : c2, ...recorte(H.semanas, H.brasil, periodo) });
    Graficos.desenhar($("#g-preco"), {
      titulo: L.tipo === "br" ? "Preço médio na bomba (R$/litro)" : `Preço na bomba: ${L.nome} × Brasil (R$/litro)`,
      subtitulo: L.tipo === "cidade" ? "Cidades: só o último ano (a ANP começou a série por cidade em 2024 no arquivo usado)." : "Média semanal da ANP.",
      prefixo: "R$ ", series: seriesPreco,
    });
    const s = H.sintese;
    Graficos.desenhar($("#g-atacado"), {
      titulo: "Gasolina A × custo de importar (R$/litro)",
      subtitulo: "Abaixo do custo de importar = pressão para subir.",
      prefixo: "R$ ",
      series: [
        { nome: "Gasolina A (média Brasil)", cor: c1, ...recorte(s.realizacao.d, s.realizacao.v, periodo) },
        { nome: "Custo de importar (PPI)", cor: c2, ...recorte(s.ppi.d, s.ppi.v, periodo) },
      ],
    });
    Graficos.desenhar($("#g-anidro"), {
      titulo: "Etanol anidro em São Paulo (R$/litro)", subtitulo: "32% da gasolina vendida no posto.",
      prefixo: "R$ ", series: [{ nome: "Etanol anidro", cor: c1, area: true, ...recorte(s.anidro.d, s.anidro.v, periodo) }],
    });
    Graficos.desenhar($("#g-brent"), {
      titulo: "Petróleo Brent (US$/barril)", subtitulo: "Referência mundial do petróleo.",
      prefixo: "US$ ", series: [{ nome: "Brent", cor: c1, area: true, ...recorte(H.mercado.brent.d, H.mercado.brent.v, periodo) }],
    });
    Graficos.desenhar($("#g-dolar"), {
      titulo: "Dólar (R$)", subtitulo: "Petróleo e gasolina importada são pagos em dólar.", casas: 2,
      prefixo: "R$ ", series: [{ nome: "Dólar", cor: c1, area: true, ...recorte(H.mercado.dolar.d, H.mercado.dolar.v, periodo) }],
    });
  }

  // ------------------------------------------------------------ notícias, método, fontes

  function tempoAtras(seg) {
    const h = (Date.now() / 1000 - seg) / 3600;
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${Math.round(h)} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  function desenharNoticias() {
    const n = P.noticias || [];
    $("#noticias").innerHTML = n.length ? n.slice(0, 12).map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.titulo)}</a>
      <div class="meta"><span>${esc(x.fonte)}</span><span>· ${tempoAtras(x.quando)}</span>${(x.etiquetas || []).map(t => `<span class="selo">${esc(t)}</span>`).join("")}</div></li>`).join("")
      : '<li class="carregando">Sem notícias no momento.</li>';
  }

  function desenharMetodo() {
    const m = P.modelo, t = m.teste_ultimo_ano, v = m.ao_vivo;
    const linhas = m.tabela.faixas.map(f => `<tr><td>${esc(f.nome)}</td><td class="num">${f.de == null ? "até " + sinal(f.ate) : f.ate == null ? "mais de " + sinal(f.de) : sinal(f.de) + " a " + sinal(f.ate)}</td>
      <td class="num">${f.casos}</td><td class="num">${pct(f.sobe)}</td><td class="num">${pct(f.igual)}</td><td class="num">${pct(f.desce)}</td></tr>`).join("");
    $("#metodo").innerHTML = `
      <ol>
        <li><b>Custo de agora.</b> A ANP publica toda semana quanto custam a gasolina A, o etanol anidro e os impostos em cada litro. Usamos a média das últimas ${m.suave} semanas, porque o custo da ANP oscila muito de uma semana para outra.</li>
        <li><b>Comparação.</b> Comparamos com o custo e o preço de ${m.ref[0]} a ${m.ref[1]} semanas atrás. Se o custo subiu mais do que o posto já subiu, "falta repassar".</li>
        <li><b>Chance.</b> Procuramos, desde 2024, todas as semanas e Estados em que a conta deu parecido e contamos o que aconteceu nas ${m.horizonte} semanas seguintes. A tabela abaixo se refaz a cada atualização, então o app aprende com as semanas novas.</li>
        <li><b>Datas marcadas.</b> Impostos e regras com data e valor conhecidos (ICMS, PIS/Cofins, mistura de etanol) entram à parte, pelo valor. São o sinal mais forte.</li>
      </ol>
      <div class="rolagem"><table><thead><tr><th>Situação</th><th class="num">Falta repassar</th><th class="num">Casos</th><th class="num">Subiu</th><th class="num">Ficou</th><th class="num">Caiu</th></tr></thead>
      <tbody>${linhas}<tr><td><b>Normal (todas)</b></td><td></td><td class="num">${m.tabela.casos}</td><td class="num">${pct(m.tabela.normal.sobe)}</td><td class="num">${pct(m.tabela.normal.igual)}</td><td class="num">${pct(m.tabela.normal.desce)}</td></tr></tbody></table></div>
      <h3 style="margin-top:14px">Quanto acerta</h3>
      <p>Teste honesto, semana a semana, nos últimos 12 meses (desde ${dataBR(t && t.desde)}), usando só o que se sabia em cada semana:
        ${t ? `quando o app apontou chance maior de alta (${t.avisos_alta} vezes em ${t.casos} semanas de Estados), o preço subiu em <b>${pct(t.avisos_alta_certos)}</b> das vezes. Sem aviso, sobe em ${pct(t.alta_normal)}.
        No geral, as chances do app erraram ${pct(t.melhora_sobre_media, 1)} menos do que usar só a média.` : "ainda sem dados suficientes."}
        É uma melhora pequena e real: o preço na bomba anda em degraus, por decisões da Petrobras, do governo e dos postos, e nenhuma conta adivinha uma decisão.</p>
      <p>Previsões gravadas ao vivo desde ${dataBR(v.desde)}: ${v.casos ? `${v.casos} conferidas, acerto do mais provável ${pct(v.acerto)}` : "ainda aguardando as semanas seguintes para conferir"}.</p>
      <h3>Limites</h3>
      <ul>
        <li>A ANP pesquisa uma amostra de postos (cerca de 4.500 por semana). Cidades pequenas entram com poucos postos.</li>
        <li>Subsídios, desonerações e reajustes podem ser anunciados de um dia para o outro. O calendário mostra o que já tem data; as notícias mostram o resto.</li>
        <li>Na cidade, a conta usa os custos nacionais. Diferenças de frete e de concorrência locais aparecem só no preço.</li>
        <li>O app não recebe dados de nenhum posto nem de você. Nada é guardado fora do seu aparelho.</li>
      </ul>`;
  }

  function desenharFontes() {
    const icone = f => !f.ok ? ["✕ Falhou", "var(--critico)"] : f.atrasada ? ["⚠ Atrasada", "var(--atencao)"] : ["✓ Funcionando", "var(--ok)"];
    $("#fontes").innerHTML = `<table><thead><tr><th>Fonte</th><th>Situação</th><th>Dado mais novo</th><th>Última tentativa ok</th><th>Detalhe</th></tr></thead><tbody>
      ${P.fontes.map(f => { const [t, c] = icone(f); return `<tr><td>${esc(f.nome)}</td><td><span class="status"><i style="background:${c}"></i>${t}</span></td>
        <td>${dataBR(f.data_dado && f.data_dado.slice(0, 10))}</td><td>${f.ultimo_sucesso ? esc(new Date(f.ultimo_sucesso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) : "—"}</td>
        <td style="white-space:normal;min-width:180px">${esc(f.ok ? (f.fonte ? "via " + f.fonte : "") : f.erro || "")}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="nota">Se uma fonte falhar, o app continua com o último dado bom dela e avisa no topo. Os dados são buscados de novo duas vezes por dia.</p>`;
  }

  // ------------------------------------------------------------ busca

  function opcoesBusca() {
    const o = [{ id: "BR", nome: "Brasil", tipo: "país" }];
    Object.entries(P.ufs).forEach(([uf, a]) => o.push({ id: uf, nome: `${a.nome} (${uf})`, tipo: "Estado", chave: semAcento(a.nome + " " + uf) }));
    if (M) M.lista.forEach(c => o.push({ id: c.id, nome: `${c.nome} (${c.uf})`, tipo: "cidade", chave: semAcento(c.nome + " " + c.uf) }));
    return o;
  }

  function ligarBusca() {
    const inp = $("#busca"), lst = $("#sugestoes");
    let itens = [], sel = -1;
    const fechar = () => { lst.hidden = true; inp.setAttribute("aria-expanded", "false"); sel = -1; };
    const mostrar = () => {
      const q = semAcento(inp.value.trim());
      if (!q || !P) return fechar();
      itens = opcoesBusca().filter(o => (o.chave || semAcento(o.nome)).includes(q))
        .sort((a, b) => (semAcento(a.nome).startsWith(q) ? 0 : 1) - (semAcento(b.nome).startsWith(q) ? 0 : 1)).slice(0, 12);
      if (!itens.length) {
        lst.innerHTML = `<li role="option" aria-disabled="true">${M ? "Nada encontrado. A ANP pesquisa só cerca de 460 cidades." : "Carregando a lista de cidades…"}</li>`;
      } else {
        lst.innerHTML = itens.map((o, i) => `<li role="option" id="op-${i}" data-i="${i}" aria-selected="${i === sel}"><span>${esc(o.nome)}</span><span class="tipo">${o.tipo}</span></li>`).join("");
      }
      lst.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    };
    const confirmar = i => {
      if (!itens[i]) return;
      escolher(itens[i].id, true);
      inp.value = "";
      fechar();
      inp.blur();
    };
    inp.addEventListener("input", () => { sel = -1; mostrar(); });
    inp.addEventListener("keydown", e => {
      if (lst.hidden) return;
      if (e.key === "ArrowDown") { sel = Math.min(itens.length - 1, sel + 1); mostrar(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); mostrar(); e.preventDefault(); }
      else if (e.key === "Enter") { confirmar(sel < 0 ? 0 : sel); e.preventDefault(); }
      else if (e.key === "Escape") fechar();
      if (sel >= 0) inp.setAttribute("aria-activedescendant", "op-" + sel);
    });
    lst.addEventListener("pointerdown", e => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); confirmar(+li.dataset.i); } });
    inp.addEventListener("blur", () => setTimeout(fechar, 150));
  }

  // ------------------------------------------------------------ controles

  function aviso(txt) {
    const t = $("#toast");
    t.textContent = txt;
    t.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function compartilhar() {
    const L = P && dadosDoLugar();
    const local = !NATIVO && /^(127\.|localhost)/.test(location.hostname);
    const u = new URL(NATIVO ? Nativo.REMOTO : local && P && P.endereco_publico ? P.endereco_publico : location.href);
    u.search = lugar === "BR" ? "" : "?local=" + encodeURIComponent(lugar);
    u.hash = "";
    let texto = "Gasolina: vai subir ou cair? Preço, previsão e os motivos.";
    if (L && L.a) texto = `Gasolina em ${L.nome}: ${reais(L.a.preco)}. ${(TEXTO_VEREDITO[L.a.veredito] || TEXTO_VEREDITO.incerto)[1]} nas próximas ${P.modelo.horizonte} semanas. Veja os motivos:`;
    if (local && !(P && P.endereco_publico)) {
      aviso("Este endereço só funciona no seu PC. Para mandar a outras pessoas, publique o app: gasolina publicar");
      return;
    }
    if (NATIVO) {
      // se o site não está no ar, manda só o texto (o link daria "página não encontrada")
      const noAr = await Nativo.conferirSite();
      await Nativo.compartilhar(document.title, noAr ? texto : texto.replace(/ Veja os motivos:$/, ""), noAr ? u.toString() : undefined);
      return;
    }
    if (navigator.share) {
      try { await navigator.share({ title: document.title, text: texto, url: u.toString() }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(texto + " " + u.toString()); aviso("Link copiado. É só colar na conversa."); }
    catch (e) { prompt("Copie o link:", u.toString()); }
  }

  function ligarControles() {
    ligarBusca();
    document.addEventListener("click", e => {
      const ln = NATIVO && e.target.closest('a[target="_blank"]');
      if (ln) { e.preventDefault(); Nativo.abrirLink(ln.href); return; }
      const b = e.target.closest("[data-lugar]");
      if (b) { escolher(b.dataset.lugar, b.closest("#mapa, #tabela-ufs") != null); return; }
      const o = e.target.closest("[data-ordem]");
      if (o) {
        const c = o.dataset.ordem;
        ordemTabela = { campo: c, desc: ordemTabela.campo === c ? !ordemTabela.desc : c !== "nome" };
        desenharTabelaUFs();
        return;
      }
      const mp = e.target.closest("[data-mapa]");
      if (mp) {
        modoMapa = mp.dataset.mapa;
        document.querySelectorAll("[data-mapa]").forEach(x => x.setAttribute("aria-pressed", x === mp));
        desenharMapa();
        return;
      }
      const pr = e.target.closest("[data-periodo]");
      if (pr) {
        periodo = +pr.dataset.periodo;
        document.querySelectorAll("[data-periodo]").forEach(x => x.setAttribute("aria-pressed", x === pr));
        desenharGraficos();
      }
    });
    document.addEventListener("keydown", e => {
      const tr = e.target.closest && e.target.closest("tr[data-lugar]");
      if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); escolher(tr.dataset.lugar, true); }
    });
    $("#bt-compartilhar").addEventListener("click", compartilhar);
    $("#bt-tema").addEventListener("click", () => {
      const escuroAgora = getComputedStyle(document.documentElement).colorScheme.includes("dark");
      const novo = escuroAgora ? "claro" : "escuro";
      document.documentElement.dataset.tema = novo;
      try { localStorage.setItem("gasolina.tema", novo); } catch (e) { }
      desenharTudo();
    });
    let pedido = null;
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedido = e; $("#bt-instalar").hidden = false; });
    $("#bt-instalar").addEventListener("click", async () => { if (!pedido) return; pedido.prompt(); await pedido.userChoice; pedido = null; $("#bt-instalar").hidden = true; });
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(desenharGraficos, 200); });
    if (NATIVO) {
      $("#lembretes").hidden = false;
      const caixa = $("#ch-lembretes");
      caixa.checked = Nativo.lembretes.ligado();
      caixa.addEventListener("change", async () => {
        if (caixa.checked) {
          const r = P ? await Nativo.lembretes.ligar(P.eventos || [], reais) : "sem-dados";
          if (r !== "ok") {
            caixa.checked = false;
            aviso(r === "negado" ? "O Android não deixou: libere as notificações do Gasolina nas Configurações." : "Não consegui ligar os lembretes agora.");
          } else aviso("Pronto: aviso às 9h na véspera e no dia de cada data.");
        } else { await Nativo.lembretes.desligar(); aviso("Lembretes desligados."); }
      });
      // o próprio celular busca nas fontes: ao abrir e ao voltar para o app (se passou de 3 h)
      $("#atualizacao").hidden = false;
      $("#bt-atualizar").addEventListener("click", () => atualizarNoCelular(true));
      Nativo.aoVoltar(() => atualizarSePreciso());
      conferirVersaoApp();
    } else if ("serviceWorker" in navigator && location.protocol !== "file:") {
      // no site: link para baixar o app Android, se já houver versão publicada
      if (!/^(127\.|localhost)/.test(location.hostname)) fetch("app-versao.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(v => {
        if (!v || !v.apk) return;
        const p = $("#baixar-apk");
        p.innerHTML = `📲 <a href="${esc(v.apk)}">Baixar o app para Android</a> (versão ${esc(v.versao)}). No celular, permita instalar "de fontes desconhecidas" quando o Android perguntar.`;
        p.hidden = false;
      }).catch(() => { });
      navigator.serviceWorker.register("sw.js").catch(() => { });
    }
    // volta para a aba depois de horas: recarrega os dados
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && P && Date.now() - new Date(P.gerado_em).getTime() > 6 * 36e5) {
        buscarJSON("painel.json").then(d => { if (d.gerado_em !== P.gerado_em) { P = d; desenharTudo(); } }).catch(() => { });
      }
    });
  }

  // ------------------------------------------------------------ atualização feita no celular

  async function atualizarSePreciso() {
    const ult = await Nativo.ultimaAtualizacao();
    if (!ult || origemDados === "embutido" || Date.now() - ult.getTime() > 3 * 36e5) atualizarNoCelular(false);
  }

  async function atualizarNoCelular(manual) {
    if (Nativo.atualizando) return;
    const st = $("#atualizacao-txt"), bt = $("#bt-atualizar");
    bt.disabled = true;
    st.textContent = "⟳ Buscando dados novos nas fontes…";
    try {
      const r = await Nativo.atualizar(m => { st.textContent = "⟳ " + m; });
      if (!r.semInternet) {
        P = await buscarJSON("painel.json");
        desenharTudo();
        buscarJSON("historico.json").then(d => { H = d; desenharGraficos(); }).catch(() => { });
        buscarJSON("municipios.json").then(d => { M = d; if (lugar.includes("/")) desenharTudo(); }).catch(() => { });
      }
      const n = r.falhas.length;
      st.textContent = r.semInternet ? "Sem internet agora: mostrando os últimos dados guardados no celular."
        : n === 0 ? "✓ Atualizado agora, direto das fontes (ANP, Banco Central, petróleo e notícias)."
        : `Atualizado, mas ${n === 1 ? "uma fonte não respondeu" : n + " fontes não responderam"}: veja os avisos acima.`;
      if (manual && !r.semInternet) aviso(n ? "Atualizado em parte." : "Atualizado.");
    } catch (e) {
      st.textContent = "Não consegui atualizar: " + e.message;
    } finally { bt.disabled = false; }
  }

  // Aviso de versão nova do APK (o arquivo app-versao.json fica no site publicado)
  async function conferirVersaoApp() {
    const meu = Nativo.versao && Nativo.versao.codigo;
    if (!meu) return;
    try {
      const r = await fetch(Nativo.REMOTO + "app-versao.json?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const v = await r.json();
      if (!(v.codigo > meu)) return;
      const div = $("#nova-versao");
      div.innerHTML = `📲 Saiu a versão ${esc(v.versao)} do app${v.novidades ? ": " + esc(v.novidades) : ""}. <a href="${esc(v.apk)}" target="_blank" rel="noopener">Baixar e instalar</a>`;
      div.hidden = false;
    } catch (e) { }
  }

  // os lembretes acompanham as mudanças do calendário
  const _desenharTudo = desenharTudo;
  let agendadoPara = null;
  desenharTudo = function () {
    _desenharTudo();
    if (NATIVO && P && P.gerado_em !== agendadoPara && Nativo.lembretes.ligado()) {
      agendadoPara = P.gerado_em;
      Nativo.lembretes.agendar(P.eventos || [], reais).catch(() => { });
    }
  };

  iniciar();
})();
