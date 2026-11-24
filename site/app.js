/* Gas: vai subir ou cair? (antes "Gasolina") — tela do app (HTML/JS puro, sem bibliotecas).
   Organizada em 6 abas: Resumo, Postos, Por quê, Estados, Agenda e Sobre.
   Os dados vêm prontos (painel.json, historico.json, municipios.json, postos/<UF>.json); aqui só se desenha. */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const semAcento = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const num = (v, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const reais = (v, casas = 2) => v == null ? "—" : "R$ " + num(v, casas);
  const sinal = (v, casas = 2) => v == null ? "—" : (v > 0.0049 ? "+" : v < -0.0049 ? "−" : "") + "R$ " + num(Math.abs(v), casas);
  const pct = (v, casas = 0) => v == null ? "—" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }) + "%";
  const pctSinal = v => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  const dataBR = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
  const dataCurtaBR = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const direcao = (v, lim = 0.0049) => v > lim ? "sobe" : v < -lim ? "desce" : "igual";

  let P = null;          // painel.json
  let H = null;          // historico.json
  let M = null;          // municipios.json
  let lugar = "BR";
  let aba = "resumo";
  let modoMapa = "previsao";
  let periodo = 52;
  let grafico = "preco";
  let ordem = "preco";
  let rankingTodos = false, cidadesTodas = false;
  let filtroNoticia = "Todas", noticiasTodas = false;
  let PO = null, poUF = null, poErro = null;   // postos/<UF>.json (preço posto a posto)
  let comb = "gasolina", postosTodos = false;

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
    mostrarAba((location.hash || "").replace("#", "") || "resumo", false);
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
    buscarJSON("historico.json").then(d => { H = d; desenharGraficos(); }).catch(() => falhaParcial("g-atual"));
    buscarJSON("municipios.json").then(d => { M = d; desenharTudo(); }).catch(() => { });
  }

  function falhaParcial(id) {
    const f = document.getElementById(id);
    if (f) f.innerHTML = '<p class="carregando">Não consegui carregar o histórico agora.</p>';
  }

  // ------------------------------------------------------------ abas

  const ABAS = ["resumo", "postos", "porque", "estados", "agenda", "sobre"];
  function mostrarAba(nome, rolar = true) {
    if (!ABAS.includes(nome)) nome = "resumo";
    aba = nome;
    for (const a of ABAS) $("#aba-" + a).hidden = a !== nome;
    $$(".abas button").forEach(b => { if (b.dataset.aba === nome) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    history.replaceState(null, "", location.pathname + location.search + (nome === "resumo" ? "" : "#" + nome));
    if (rolar) window.scrollTo({ top: 0 });
    if (nome === "porque") desenharGraficos();
    if (nome === "postos" && P) desenharPostos(dadosDoLugar());
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

  function escolher(id, irResumo) {
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
    cidadesTodas = false; postosTodos = false; selPosto = null; filtroPosto = "";
    const bp = document.getElementById("busca-posto"); if (bp) bp.value = "";
    desenharTudo();
    if (irResumo) mostrarAba("resumo");
  }

  function removerAtalho(id) {
    try {
      const rec = JSON.parse(localStorage.getItem("gasolina.recentes") || "[]").filter(x => x !== id);
      localStorage.setItem("gasolina.recentes", JSON.stringify(rec));
    } catch (e) { }
    const nome = nomeCurto(id);
    if (id === lugar) escolher("BR"); else desenharAtalhos();
    aviso(`${nome} saiu dos atalhos.`);
  }

  function lerPreferencias() {
    const q = new URLSearchParams(location.search).get("local");
    let guardado = null;
    try { guardado = localStorage.getItem("gasolina.lugar"); } catch (e) { }
    lugar = (q || guardado || "BR").toUpperCase();
    try { aplicarTema(localStorage.getItem("gasolina.tema") || "auto", false); } catch (e) { }
    try { const c = localStorage.getItem("gasolina.combustivel"); if (COMBS.includes(c)) comb = c; } catch (e) { }
  }

  function aplicarTema(t, guardar = true) {
    if (t === "claro" || t === "escuro") document.documentElement.dataset.tema = t;
    else delete document.documentElement.dataset.tema;
    $$("[data-tema]").forEach(b => { if (b.tagName === "BUTTON") b.setAttribute("aria-pressed", b.dataset.tema === (t || "auto")); });
    if (guardar) { try { localStorage.setItem("gasolina.tema", t); } catch (e) { } }
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
    montarExplicacoes();
    desenharFrescor();
    desenharAvisos();
    desenharAtalhos();
    desenharHeroi(L);
    desenharPrevisao(L);
    desenharMotivos(L);
    desenharProximas(L);
    desenharConta(L);
    desenharComposicao();
    desenharPressao(L);
    desenharMercado(L);
    desenharMapa();
    desenharRanking();
    desenharCidades(L);
    if (lugar.includes("/")) carregarPostos(lugar.split("/")[0]);
    desenharPostos(L);
    desenharEventos(L);
    desenharNoticias();
    desenharMetodo();
    desenharFontes();
    if (H && aba === "porque") desenharGraficos();
    document.title = `Gas · ${L.nome}: vai subir ou cair?`;
  }

  function desenharFrescor() {
    const g = new Date(P.gerado_em);
    const horas = (Date.now() - g.getTime()) / 36e5;
    const quando = g.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " às");
    let t = `Atualizado em ${quando} · preços da ANP de ${dataCurtaBR(P.semana_inicio)} a ${dataBR(P.semana)}`;
    if (horas > 36) t = `⚠ Os dados não são atualizados desde ${quando}. Preços da ANP de ${dataCurtaBR(P.semana_inicio)} a ${dataBR(P.semana)}`;
    if (NATIVO && origemDados === "embutido") t = "Dados que vieram junto com o app. " + t;
    $("#frescor").textContent = t;
    $("#rodape-dados").textContent = `Dados: ANP (Levantamento de Preços e Síntese Semanal), Banco Central, EIA/Ipeadata, Yahoo Finance e Google Notícias. A ANP publica os preços uma vez por semana. Última atualização: ${quando}.`;
    $("#versao-app").textContent = NATIVO && Nativo.versao ? `App Android, versão ${Nativo.versao.versao}.` : "";
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
    if (!ids.includes(lugar)) ids.splice(1, 0, lugar);
    $("#atalhos").innerHTML = ids.map(id => `<span class="chip${id === lugar ? " ativo" : ""}"><button type="button" data-lugar="${esc(id)}" aria-pressed="${id === lugar}">${id === lugar ? "📍 " : ""}${esc(nomeCurto(id))}</button>${id === "BR" ? "" :
      `<button type="button" class="remover" data-remover="${esc(id)}" aria-label="Tirar ${esc(nomeCurto(id))} dos atalhos" title="Tirar dos atalhos">×</button>`}</span>`).join("");
  }

  // ------------------------------------------------------------ RESUMO: preço

  function desenharHeroi(L) {
    $("#t-lugar").textContent = `Gasolina comum · ${L.nome}`;
    if (!L.a && L.tipo !== "cidade") {
      $("#preco").textContent = "…";
      $("#preco-var").textContent = ""; $("#preco-var").className = "variacao";
      $("#preco-detalhe").textContent = "";
      $("#preco-faixa").innerHTML = "";
      return;
    }
    const preco = L.a ? L.a.preco : L.cidade.p;
    $("#preco").innerHTML = `${esc(reais(preco))} <small>/litro</small>`;
    const v = L.a ? L.a.var_semana : null;
    const pv = $("#preco-var");
    if (v == null) { pv.textContent = ""; pv.className = "variacao"; }
    else {
      const d = direcao(v);
      pv.className = "variacao " + d;
      pv.textContent = d === "igual" ? "= igual à semana anterior" : `${d === "sobe" ? "▲" : "▼"} ${reais(Math.abs(v))} na semana`;
    }
    const f = L.cidade ? L.cidade.faixa_precos : L.a && L.a.faixa_precos;
    $("#preco-detalhe").textContent = `Média ${f && f.n ? `de ${f.n.toLocaleString("pt-BR")} postos pesquisados ` : ""}pela ANP de ${dataCurtaBR(P.semana_inicio)} a ${dataBR(P.semana)}.`;
    if (f && f.min && f.max && f.max > f.min) {
      const x = Math.max(4, Math.min(96, (preco - f.min) / (f.max - f.min) * 100));
      $("#preco-faixa").innerHTML = `<div class="faixa-precos" role="img" aria-label="Mais barato ${reais(f.min)}, mais caro ${reais(f.max)}">
        <div class="trilho"><span class="marca-media" style="left:${x}%"></span></div>
        <div class="pontas"><span>Mais barato <b>${reais(f.min)}</b></span><span>Mais caro <b>${reais(f.max)}</b></span></div></div>`;
    } else $("#preco-faixa").innerHTML = "";
  }

  // ------------------------------------------------------------ RESUMO: previsão

  const TEXTO_VEREDITO = {
    sobe: ["▲", "Mais chance de subir", "A chance de o preço subir está acima do normal."],
    desce: ["▼", "Mais chance de cair", "A chance de o preço cair está acima do normal."],
    igual: ["=", "Deve ficar parecido", "O mais provável é o preço ficar perto do de hoje."],
    incerto: ["?", "Sem sinal claro", "Os sinais apontam para lados diferentes; nada se destaca."],
  };

  function desenharPrevisao(L) {
    const a = L.a;
    const seta = $("#prev-seta");
    $("#t-prev").textContent = `Previsão para as próximas ${P.modelo.horizonte} semanas`;
    if (!a) {
      seta.className = "seta"; seta.textContent = "·";
      $("#prev-texto").textContent = L.tipo === "carregando" ? "Carregando…" : "Poucos dados nesta cidade";
      $("#prev-frase").textContent = L.tipo === "cidade" ? "A ANP não pesquisa esta cidade toda semana. Veja a previsão do Estado." : "";
      $("#prev-chances").innerHTML = ""; $("#prev-alertas").innerHTML = "";
      $("#prev-confianca").textContent = "";
      return;
    }
    const n = P.modelo.tabela.normal;
    let [s, titulo, frase] = TEXTO_VEREDITO[a.veredito] || TEXTO_VEREDITO.incerto;
    if (a.soma_eventos >= 0.05) { titulo = "Deve subir"; frase = `Tem aumento marcado: cerca de ${reais(a.soma_eventos)} por litro.`; }
    if (a.soma_eventos <= -0.05) { titulo = "Deve cair"; frase = `Tem redução marcada: cerca de ${reais(-a.soma_eventos)} por litro.`; }
    if (a.veredito === "igual" && !(Math.abs(a.soma_eventos) >= 0.05)) frase = `O mais provável é o preço continuar perto de ${reais(a.preco)}.`;
    seta.className = "seta " + (a.veredito === "sobe" ? "sobe" : a.veredito === "desce" ? "desce" : "");
    seta.textContent = s;
    $("#prev-texto").textContent = titulo;
    $("#prev-frase").textContent = frase;
    const ch = a.chances;
    const linha = (nome, v, nor, cor) => `<div class="chance"><span>${nome}</span>
      <div class="trilho" role="img" aria-label="${nome}: ${pct(v)} (normal ${pct(nor)})"><i style="width:${Math.max(2, v * 100)}%;background:${cor}"></i><span class="normal" style="left:${nor * 100}%"></span></div>
      <b>${pct(v)}</b></div>`;
    $("#prev-chances").innerHTML =
      linha("Subir", ch.sobe, n.sobe, "var(--sobe)") +
      linha("Ficar igual", ch.igual, n.igual, "var(--mudo)") +
      linha("Cair", ch.desce, n.desce, "var(--desce)") +
      `<div class="legenda-normal"><i></i> o normal (média desde 2024) · subir ou cair = mudar mais de ${reais(P.modelo.limiar)} por litro</div>`;
    let html = "";
    if (a.eventos && a.eventos.length) html += `<div class="alerta sobe">${a.eventos.map(e => `📅 <b>${dataCurtaBR(e.data)}</b>: ${esc(e.titulo)} (${sinal(e.efeito)} por litro)`).join("<br>")}</div>`;
    const an = anunciosDoLugar(L);
    if (an.length) html += `<div class="alerta">📰 Manchete recente: <a href="${esc(an[0].link)}" target="_blank" rel="noopener">${esc(an[0].titulo)}</a>
      <br><small>${an[0].especulacao ? "Parece especulação, não anúncio. " : ""}Anúncios de refinaria costumam chegar à bomba em 1 a 3 semanas, nem sempre inteiros.</small></div>`;
    $("#prev-alertas").innerHTML = html;
    const t = P.modelo.teste_ultimo_ano;
    $("#prev-confianca").innerHTML = t && t.avisos_alta
      ? `É uma estimativa, não uma certeza. No último ano, quando o app indicou mais chance de alta, o preço subiu em <b>${pct(t.avisos_alta_certos)}</b> das vezes (sem aviso, sobe em ${pct(t.alta_normal)}). O sinal mais forte são as datas marcadas, como impostos.`
      : "É uma estimativa, não uma certeza. O sinal mais forte são as datas marcadas, como impostos.";
  }

  function anunciosDoLugar(L) {
    const priv = /ACELEN|MATARIPE/i, ream = /\bREAM\b|AMAZ[ÔO]NIA/i;
    return (P.anuncios || []).filter(n => {
      if (priv.test(n.titulo)) return ["BA", "SE", "AL"].includes(L.uf);
      if (ream.test(n.titulo)) return ["AM", "RR", "AC", "RO"].includes(L.uf);
      return true;
    });
  }

  // ------------------------------------------------------------ RESUMO: motivos em linguagem simples

  function desenharMotivos(L) {
    const a = L.a, itens = [];
    const onde = L.tipo === "br" ? "os postos do país" : L.tipo === "cidade" ? "os postos da cidade" : "os postos do Estado";
    if (a) {
      const c = a.custos_mudaram, tot = c.gasolina_a + c.anidro + c.federais + c.icms, ja = a.ja_repassado, f = a.falta_repassar;
      const verbo = (v, m, f2) => Math.abs(v) < 0.01 ? "ficaram estáveis" : v > 0 ? `${m} ${reais(Math.abs(v))}` : `${f2} ${reais(Math.abs(v))}`;
      const titulo = f > 0.1 ? "Os custos subiram mais do que o preço" : f < -0.1 ? "O preço está acima dos custos" : "Preço e custos estão equilibrados";
      const resto = f > 0.1 ? `Ainda faltam cerca de ${reais(f)} por litro para chegar à bomba.` : f < -0.1 ? `Sobram cerca de ${reais(-f)} por litro, que podem virar redução.` : "Quase nada falta repassar.";
      itens.push({ ic: f > 0.1 ? "▲" : f < -0.1 ? "▼" : "⚖️", cls: f > 0.1 ? "sobe" : f < -0.1 ? "desce" : "", titulo,
        texto: `Nas últimas semanas, os custos (refinaria, etanol e impostos) ${tot >= 0 ? verbo(tot, "subiram", "caíram") : verbo(tot, "subiram", "caíram")} por litro e ${onde} ${Math.abs(ja) < 0.01 ? "mantiveram o preço" : (ja > 0 ? "subiram " : "baixaram ") + reais(Math.abs(ja))}. ${resto}` });
    }
    const p = P.pressao;
    if (p) {
      const d = p.defasagem;
      if (d < -0.05) itens.push({ ic: "🌎", cls: "sobe", titulo: "A gasolina daqui está mais barata que a importada",
        texto: `As refinarias daqui vendem ${pct(-d)} mais barato do que custaria trazer de fora. Isso costuma levar a aumento.` });
      else if (d > 0.05) itens.push({ ic: "🌎", cls: "desce", titulo: "A gasolina daqui está mais cara que a importada",
        texto: `As refinarias daqui vendem ${pct(d)} mais caro do que custaria trazer de fora. Há espaço para baixar.` });
      else itens.push({ ic: "🌎", cls: "", titulo: "Gasolina daqui custa quase o mesmo que a importada", texto: "Pouca pressão vinda de fora." });
    }
    const m = P.mercado;
    if (m.brent && m.dolar && m.brent.var30 != null && m.dolar.var30 != null) {
      const efeito = (1 + m.brent.var30) * (1 + m.dolar.var30) - 1;
      if (Math.abs(efeito) > 0.04) itens.push({ ic: "🛢️", cls: efeito > 0 ? "sobe" : "desce",
        titulo: efeito > 0 ? "Petróleo e dólar encareceram a importação" : "Petróleo e dólar baratearam a importação",
        texto: `Em 30 dias: petróleo ${pctSinal(m.brent.var30)} e dólar ${pctSinal(m.dolar.var30)}. Juntos, o barril em reais mudou ${pctSinal(efeito)}.` });
    }
    const ev = (P.eventos || []).find(e => e.efeito && e.dias >= 0 && e.dias <= 60 && e.status !== "aconteceu" && e.status !== "cancelado");
    if (ev) itens.push({ ic: "📅", cls: ev.efeito > 0 ? "sobe" : "desce", titulo: `${dataBR(ev.data)}: ${ev.titulo}`,
      texto: `${ev.status === "depende" ? "Pode mudar até lá. Se acontecer, " : ""}o litro ${ev.efeito > 0 ? "sobe" : "cai"} cerca de ${reais(Math.abs(ev.efeito))}.` });
    if (L.uf && P.ufs[L.uf] && P.ufs[L.uf].refinaria_privada)
      itens.push({ ic: "🏭", cls: "", titulo: "Refinaria privada abastece a região", texto: `${P.ufs[L.uf].refinaria_privada} acompanha o mercado internacional de perto: aqui petróleo e dólar chegam mais rápido à bomba.` });
    $("#motivos").innerHTML = itens.map(i => `<li><span class="ic ${i.cls}" aria-hidden="true">${i.ic}</span><div><b>${esc(i.titulo)}</b><span>${esc(i.texto)}</span></div></li>`).join("")
      || '<li class="carregando">Sem dados suficientes.</li>';
  }

  const STATUS = {
    confirmado: ["Confirmado", "var(--ok)"],
    depende: ["Pode mudar", "var(--atencao)"],
    aconteceu: ["Já aconteceu", "var(--mudo)"],
    cancelado: ["Cancelado", "var(--mudo)"],
  };
  const quandoEvento = e => e.andamento ? "acontecendo agora" : e.dias > 1 ? `em ${e.dias} dias` : e.dias === 1 ? "amanhã" : e.dias === 0 ? "hoje" : `há ${-e.dias} dias`;
  const diaEvento = d => `<div class="dia">${d.slice(8, 10)}<small>${MESES[+d.slice(5, 7) - 1]}${d.slice(0, 4) !== String(new Date().getFullYear()) ? "/" + d.slice(2, 4) : ""}</small></div>`;
  const seloStatus = e => { const [st, cor] = e.verificar ? ["Conferir!", "var(--critico)"] : (STATUS[e.status] || STATUS.depende); return `<span class="selo"><i style="background:${cor}"></i>${st}</span>`; };
  const seloEfeito = e => e.efeito ? `<span class="selo ${e.efeito > 0 ? "sobe" : "desce"}">${sinal(e.efeito)}/litro${e.status === "depende" ? " se acontecer" : ""}</span>` : "";

  function desenharProximas() {
    const lista = (P.eventos || []).filter(e => e.dias >= 0 || e.andamento).slice(0, 3);
    $("#proximas").innerHTML = lista.map(e => `<li>${diaEvento(e.data)}<div><div class="tit">${esc(e.titulo)}</div>
      <div class="meta">${seloStatus(e)}${seloEfeito(e)}<span class="selo">${quandoEvento(e)}</span></div></div></li>`).join("")
      || '<li class="carregando">Nenhuma data marcada.</li>';
  }

  // ------------------------------------------------------------ POR QUÊ

  function desenharComposicao() {
    const c = P.composicao;
    const partes = [
      ["Gasolina pura", "vendida pelas refinarias (gasolina A)", c.gasolina_a, "--c1", false],
      ["Etanol", "álcool misturado (32% do litro)", c.anidro, "--c2", false],
      ["Impostos federais", "PIS/Cofins e Cide", c.federais, "--c3", false],
      ["ICMS", "imposto do Estado (igual no país)", c.icms, "--c4", true],
      ["Transporte e postos", "frete, distribuidora e lucro do posto", c.margens, "--c5", false],
    ];
    const tot = c.total;
    $("#composicao").innerHTML =
      `<div class="segbarra" role="img" aria-label="${partes.map(p => `${p[0]} ${reais(p[2])}`).join(", ")}">
        ${partes.filter(p => p[2] > 0).map(p => {
          const sh = p[2] / tot;
          return `<div class="${p[4] ? "escura" : ""}" style="flex:${p[2]};background:var(${p[3]})" title="${p[0]}: ${reais(p[2])} (${pct(sh)})">${sh >= 0.1 ? pct(sh) : ""}</div>`;
        }).join("")}</div>
      <div class="legenda-comp">${partes.map(p => `<div><i style="background:var(${p[3]})"></i><span>${p[0]}<small>${p[1]}</small></span><b class="num">${reais(p[2])}</b></div>`).join("")}</div>
      <p class="nota">Total ${reais(tot)} por litro · semana até ${dataBR(P.composicao_semana)} · Síntese Semanal da ANP.</p>`;
  }

  function desenharConta(L) {
    const a = L.a;
    const box = $("#conta");
    if (!a) { box.innerHTML = '<p class="carregando">Sem dados suficientes para a conta neste lugar.</p>'; return; }
    const c = a.custos_mudaram;
    const totalCustos = c.gasolina_a + c.anidro + c.federais + c.icms;
    const linhas = [
      ["Gasolina pura", "das refinarias · 68% do litro", c.gasolina_a],
      ["Etanol", "álcool misturado · 32% do litro", c.anidro],
      ["Impostos federais", "PIS/Cofins e Cide", c.federais],
      ["ICMS", "imposto do Estado", c.icms],
    ];
    const ch = a.chances;
    const faixa = P.modelo.tabela.faixas[ch.faixa];
    const onde = L.tipo === "br" ? "Postos do país" : L.tipo === "cidade" ? "Postos da cidade" : "Postos do Estado";
    box.innerHTML = `<div class="conta">${linhas.map(([n, d, v]) => `<div class="conta-linha"><span>${n}<small>${d}</small></span><b class="num ${direcao(v)}">${sinal(v)}</b></div>`).join("")}</div>
      <div class="resultados">
        <div class="resultado"><span>Os custos mudaram</span><b class="${direcao(totalCustos)}">${sinal(totalCustos)}</b></div>
        <div class="resultado"><span>${onde} já mudaram</span><b class="${direcao(a.ja_repassado)}">${sinal(a.ja_repassado)}</b></div>
        <div class="resultado destaque"><span>Falta chegar à bomba</span><b class="${direcao(a.falta_repassar, 0.05)}">${sinal(a.falta_repassar)}</b></div>
      </div>
      <p class="nota">Situação: <b>${esc(faixa ? faixa.nome : "—")}</b>. Desde 2024, nas semanas com a conta parecida, o preço subiu em ${pct(faixa && faixa.sobe)}, caiu em ${pct(faixa && faixa.desce)} e ficou parado em ${pct(faixa && faixa.igual)} das vezes nas ${P.modelo.horizonte} semanas seguintes.
        Valores por litro; média das últimas ${P.modelo.suave} semanas contra a de ${P.modelo.ref[0]} a ${P.modelo.ref[1]} semanas atrás.
        ${L.tipo === "cidade" ? "Na cidade, a conta usa os custos do Brasil e o preço da própria cidade." : ""}
        ${a.semana_custo !== a.semana ? `Os custos desta semana ainda não saíram; usei os da semana até ${dataBR(a.semana_custo)}.` : ""}</p>`;
  }

  function desenharPressao() {
    const p = P.pressao;
    if (!p) { $("#pressao").innerHTML = '<p class="carregando">Sem dados.</p>'; return; }
    const d = p.defasagem;
    const x = Math.max(3, Math.min(97, 50 + d * 100));
    $("#pressao").innerHTML = `<p class="frase-grande">As refinarias daqui vendem o litro da gasolina pura por <b>${reais(p.realizacao)}</b>: <b>${pct(Math.abs(d))} ${d < 0 ? "mais barato" : "mais caro"}</b> do que trazer de fora (≈ ${reais(p.ppi_estimado)}).</p>
      <div class="medidor" role="img" aria-label="Diferença para o preço de importação: ${pctSinal(d)}">
        <span class="zero"></span><span class="ponteiro" style="left:${x}%;background:${d < -0.02 ? "var(--sobe)" : d > 0.02 ? "var(--desce)" : "var(--mudo)"}"></span></div>
      <div class="escala"><span>Mais barata que a importada<br>(pressão para subir)</span><span style="text-align:right">Mais cara que a importada<br>(espaço para cair)</span></div>
      <p class="nota">${d < -0.1 ? "Bem mais barata: aumenta a chance de a Petrobras subir o preço, e quem importa compra menos, porque teria prejuízo." :
        d > 0.05 ? "Mais cara: há espaço para as refinarias baixarem o preço." : "Quase igual: pouca pressão vinda de fora."}
        Preço da importada calculado pela ANP de ${dataBR(p.data_ppi)}${p.data_estimativa > p.data_ppi ? `, corrigido até ${dataBR(p.data_estimativa)} pelo petróleo e pelo dólar` : ""}.</p>`;
  }

  function desenharMercado(L) {
    const m = P.mercado;
    const bloco = (nome, x, fmt) => x ? `<div class="bloco"><span>${nome}</span><b>${fmt(x.valor)}</b>
      <span class="selo ${direcao(x.var30, 0.005)}">${pctSinal(x.var30)} em 30 dias</span><br><small>dado de ${dataCurtaBR(x.data)}</small></div>` : "";
    $("#mercado").innerHTML =
      bloco("Petróleo (barril, preço mundial)", m.brent, v => "US$ " + num(v)) +
      bloco("Dólar", m.dolar, v => reais(v)) +
      bloco("Etanol da mistura (litro, SP)", m.anidro, v => reais(v)) +
      bloco("Gasolina das refinarias (litro)", m.realizacao, v => reais(v));
    $("#refinaria").innerHTML = L.uf && P.ufs[L.uf] && P.ufs[L.uf].refinaria_privada
      ? `<div class="alerta">🏭 ${esc(P.ufs[L.uf].nome)} recebe boa parte da gasolina de refinaria privada (${esc(P.ufs[L.uf].refinaria_privada)}), que acompanha o mercado internacional de perto: aqui petróleo e dólar chegam mais rápido à bomba, para cima e para baixo.</div>` : "";
  }

  function recorte(d, v, semanas) {
    if (!semanas) return { d, v };
    const ini = new Date(Date.now() - semanas * 7 * 864e5).toISOString().slice(0, 10);
    const i = d.findIndex(x => x >= ini);
    return i < 0 ? { d: [], v: [] } : { d: d.slice(i), v: v.slice(i) };
  }

  function desenharGraficos() {
    if (!H || !P || aba !== "porque") return;
    const fig = $("#g-atual");
    const c1 = cssVar("--s1"), c2 = cssVar("--s2");
    const L = dadosDoLugar() || { tipo: "br" };
    const s = H.sintese;
    let op;
    if (grafico === "preco") {
      const series = [];
      if (L.tipo === "uf") series.push({ nome: L.nome, cor: c1, ...recorte(H.semanas, H.ufs[L.uf], periodo) });
      if (L.tipo === "cidade" && M) series.push({ nome: L.cidade.nome, cor: c1, ...recorte(M.semanas, L.cidade.serie, periodo) });
      series.push({ nome: "Brasil", cor: L.tipo === "br" ? c1 : c2, area: L.tipo === "br", ...recorte(H.semanas, H.brasil, periodo) });
      op = { titulo: L.tipo === "br" ? "Preço médio na bomba (R$/litro)" : `Preço na bomba: ${L.nome} × Brasil (R$/litro)`,
        subtitulo: L.tipo === "cidade" ? "Cidades: só o último ano (série por cidade da ANP)." : "Média semanal da ANP.", prefixo: "R$ ", series };
    } else if (grafico === "atacado") {
      op = { titulo: "Refinarias × gasolina importada (R$/litro)", subtitulo: "Refinaria abaixo da importada = pressão para subir.", prefixo: "R$ ",
        series: [{ nome: "Gasolina das refinarias", cor: c1, ...recorte(s.realizacao.d, s.realizacao.v, periodo) },
          { nome: "Gasolina importada", cor: c2, ...recorte(s.ppi.d, s.ppi.v, periodo) }] };
    } else if (grafico === "anidro") {
      op = { titulo: "Etanol da mistura em São Paulo (R$/litro)", subtitulo: "32% da gasolina vendida no posto.", prefixo: "R$ ",
        series: [{ nome: "Etanol", cor: c1, area: true, ...recorte(s.anidro.d, s.anidro.v, periodo) }] };
    } else if (grafico === "brent") {
      op = { titulo: "Petróleo (US$ por barril)", subtitulo: "Preço mundial de referência (Brent).", prefixo: "US$ ",
        series: [{ nome: "Brent", cor: c1, area: true, ...recorte(H.mercado.brent.d, H.mercado.brent.v, periodo) }] };
    } else {
      op = { titulo: "Dólar (R$)", subtitulo: "Petróleo e gasolina importada são pagos em dólar.", casas: 2, prefixo: "R$ ",
        series: [{ nome: "Dólar", cor: c1, area: true, ...recorte(H.mercado.dolar.d, H.mercado.dolar.v, periodo) }] };
    }
    Graficos.desenhar(fig, op);
  }

  // ------------------------------------------------------------ ESTADOS

  const GRADE = {
    RR: [0, 1], AP: [0, 2], AM: [1, 1], PA: [1, 2], MA: [1, 3], CE: [1, 4], RN: [1, 5],
    AC: [2, 0], RO: [2, 1], TO: [2, 2], PI: [2, 3], PE: [2, 4], PB: [2, 5],
    MT: [3, 1], GO: [3, 2], BA: [3, 3], SE: [3, 4], AL: [3, 5],
    MS: [4, 1], DF: [4, 2], MG: [4, 3], ES: [4, 4],
    PR: [5, 1], SP: [5, 2], RJ: [5, 3], SC: [6, 1], RS: [7, 1],
  };
  const SEQ = ["#cde2fb", "#9ec5f4", "#5598e7", "#256abf", "#104281"];
  const DIV = ["#2a78d6", "#9ec5f4", "NEUTRO", "#f3a3a2", "#e34948"];
  const textoSobre = hex => {
    if (!hex.startsWith("#")) return "var(--tinta)";
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    const L = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2] > 0.36 ? "#0b0b0b" : "#ffffff";
  };
  const indicePrevisao = a => {
    const n = P.modelo.tabela.normal;
    const d = (a.chances.sobe - n.sobe) - (a.chances.desce - n.desce) + (a.soma_eventos || 0) * 2;
    return d > 0.15 ? 4 : d > 0.05 ? 3 : d < -0.15 ? 0 : d < -0.05 ? 1 : 2;
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
    const f = DIV[indicePrevisao(a)];
    return f === "NEUTRO" ? { fundo: "var(--neutro)", texto: "var(--tinta)" } : { fundo: f, texto: textoSobre(f) };
  }

  function desenharMapa() {
    const box = $("#mapa");
    const atual = lugar.split("/")[0];
    box.innerHTML = Object.entries(GRADE).map(([uf, [l, c]]) => {
      const a = P.ufs[uf];
      const { fundo, texto } = corUF(uf);
      const rot = a ? `${a.nome}: ${reais(a.preco)}; chance de subir ${pct(a.chances.sobe)}` : uf;
      return `<button type="button" data-lugar="${uf}" class="${uf === atual ? "atual" : ""}" style="grid-row:${l + 1};grid-column:${c + 1};background:${fundo};color:${texto}" aria-label="${esc(rot)}" title="${esc(rot)}">
        <b>${uf}</b><span>${a ? (modoMapa === "preco" ? num(a.preco) : pct(a.chances.sobe)) : ""}</span></button>`;
    }).join("");
    const leg = $("#mapa-legenda");
    if (modoMapa === "preco") {
      const ps = Object.values(P.ufs).map(x => x.preco);
      leg.innerHTML = `<b>Preço médio da gasolina comum (R$/litro)</b>
        <div class="rampa" style="background:linear-gradient(90deg,${SEQ.join(",")})"></div>
        <div class="escala"><span>${reais(Math.min(...ps))}</span><span>${reais(Math.max(...ps))}</span></div>
        <p class="nota">Mais escuro = mais caro. Com o ICMS igual em todo o país, a diferença vem do frete, da distância da refinaria e da concorrência entre postos.</p>`;
    } else {
      leg.innerHTML = `<b>Chance de subir nas próximas ${P.modelo.horizonte} semanas</b>
        <div class="chaves">
          <span class="chave"><i style="background:#e34948"></i>bem maior que o normal</span>
          <span class="chave"><i style="background:#f3a3a2"></i>maior</span>
          <span class="chave"><i style="background:var(--neutro)"></i>normal</span>
          <span class="chave"><i style="background:#9ec5f4"></i>menor</span>
          <span class="chave"><i style="background:#2a78d6"></i>bem menor</span>
        </div>
        <p class="nota">O número é a chance de subir (normal: ${pct(P.modelo.tabela.normal.sobe)}). Toque num Estado para ver o resumo dele.</p>`;
    }
  }

  function desenharRanking() {
    const linhas = Object.entries(P.ufs).sort((x, y) => ordem === "preco" ? x[1].preco - y[1].preco : y[1].chances.sobe - x[1].chances.sobe);
    const mostrar = rankingTodos ? linhas : linhas.slice(0, 10);
    const atual = lugar.split("/")[0];
    $("#tabela-ufs").innerHTML = mostrar.map(([uf, a]) => {
      const i = indicePrevisao(a);
      const cls = i >= 3 ? "sobe" : i <= 1 ? "desce" : "";
      return `<li data-lugar="${uf}" tabindex="0" class="${uf === atual ? "atual" : ""}"><span class="nome">${esc(a.nome)}<small>${uf}</small></span>
        <span class="dir">${ordem === "preco" ? `<b>${reais(a.preco)}</b>` : `<span class="selo ${cls}">${pct(a.chances.sobe)} de subir</span><b>${reais(a.preco)}</b>`}</span></li>`;
    }).join("") + (linhas.length > 10 ? `<li class="mais"><button type="button" data-mais="ranking">${rankingTodos ? "Mostrar menos" : `Ver os ${linhas.length} Estados`}</button></li>` : "");
  }

  function desenharCidades(L) {
    const uf = L.uf;
    const box = $("#cidades");
    if (!uf) { $("#t-cidades").textContent = "Cidades"; box.innerHTML = '<li class="mais carregando">Escolha um Estado (no mapa ou na busca) para ver as cidades dele.</li>'; return; }
    $("#t-cidades").textContent = `Cidades · ${P.ufs[uf] ? P.ufs[uf].nome : uf}`;
    if (!M) { box.innerHTML = '<li class="mais carregando">Carregando…</li>'; return; }
    const lista = M.lista.filter(c => c.uf === uf).sort((a, b) => a.p - b.p);
    const mostrar = cidadesTodas ? lista : lista.slice(0, 10);
    box.innerHTML = mostrar.map(c => `<li data-lugar="${esc(c.id)}" tabindex="0" class="${c.id === lugar ? "atual" : ""}"><span class="nome">${esc(c.nome)}</span>
      <span class="dir"><b>${reais(c.p)}</b></span></li>`).join("")
      + (lista.length > 10 ? `<li class="mais"><button type="button" data-mais="cidades">${cidadesTodas ? "Mostrar menos" : `Ver as ${lista.length} cidades`}</button></li>` : "")
      || '<li class="mais carregando">A ANP não pesquisou cidades deste Estado nesta semana.</li>';
  }

  // ------------------------------------------------------------ POSTOS (preço posto a posto, ANP) + mini mapa

  const COMBS = ["gasolina", "etanol", "diesel_s10", "diesel"];
  const NOME_COMB = { gasolina: "Gasolina", aditivada: "Aditivada", etanol: "Etanol", diesel_s10: "Diesel S10", diesel: "Diesel comum", gnv: "GNV" };
  const ORDEM_OUTROS = ["gasolina", "aditivada", "etanol", "diesel_s10", "diesel", "gnv"];
  const BANDEIRAS = { BRANCA: "Bandeira branca", VIBRA: "Petrobras (Vibra)", RAIZEN: "Shell (Raízen)", IPIRANGA: "Ipiranga", ALE: "ALE" };
  const COR_BANDEIRA = { VIBRA: "#00823f", RAIZEN: "#c8102e", IPIRANGA: "#0b4ea2", ALE: "#1f5fa8", BRANCA: "#5c636e" };
  const PEQUENAS = new Set(["da", "de", "do", "das", "dos", "e", "em"]);
  const SUFIXOS = new Set(["LTDA", "LTDA.", "EIRELI", "EPP", "ME", "S/A", "SA", "S.A.", "S.A", "-", "–"]);
  const bonito = t => String(t || "").split(" ").filter(Boolean).map((w, i) => {
    const m = w.toLowerCase();
    if (i > 0 && PEQUENAS.has(m)) return m;
    if (/\d/.test(w) || /^(BR|GNV|JK|II|III|IV)$/.test(w)) return w;
    return m.charAt(0).toUpperCase() + m.slice(1);
  }).join(" ");
  function nomePosto(n) {
    const w = String(n || "").split(" ").filter(Boolean);
    while (w.length > 1 && SUFIXOS.has(w[w.length - 1].toUpperCase())) w.pop();
    return bonito(w.join(" "));
  }
  const bandeira = b => BANDEIRAS[b] || bonito(b);
  const endLimpo = e => String(e || "").replace(/\s*\((?:0+|-+|\.+|SN|S\/N|N\/A)?\)\s*$/i, "");
  const mediana = xs => { const o = [...xs].sort((a, b) => a - b), m = o.length >> 1; return o.length ? (o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2) : null; };
  const diasDesde = iso => Math.round((Date.now() - new Date(iso + "T12:00").getTime()) / 864e5);
  function metros(a, b) {
    const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
  }
  const distTxt = m => m == null ? "" : m < 950 ? `${Math.round(m / 50) * 50 || 50} m` : `${num(m / 1000, m < 10000 ? 1 : 0)} km`;

  let LO = null;                 // locais/<UF>.json: onde fica cada posto
  let eu = null;                 // [lat, lon] de quem usa (só na memória, nunca guardado)
  let ordemPostos = "preco", filtroPosto = "", selPosto = null;

  async function carregarPostos(uf) {
    if (poUF === uf) return;
    poUF = uf; PO = null; LO = null; poErro = null;
    try { PO = NATIVO ? await Nativo.postos(uf) : await buscarJSON("postos/" + uf + ".json"); }
    catch (e) { poErro = "Não consegui carregar os preços dos postos agora. Confira a internet."; }
    try { LO = NATIVO ? await Nativo.locais(uf) : await buscarJSON("locais/" + uf + ".json"); } catch (e) { LO = null; }
    if (poUF !== uf) return;
    desenharPostosTudo();
    if (NATIVO) {
      atualizarPostosCelular(uf, false);
      Nativo.atualizarLocais(uf).then(d => { if (d && poUF === uf) { LO = d; desenharPostosTudo(); } }).catch(() => { });
    }
  }

  async function atualizarPostosCelular(uf, forcar) {
    const st = $("#postos-status");
    const t = setTimeout(() => { st.textContent = "⟳ Conferindo se a ANP publicou preços novos dos postos…"; }, 1200);
    try {
      const novo = await Nativo.atualizarPostos(uf, forcar);
      clearTimeout(t);
      st.textContent = "";
      if (novo && poUF === uf) { PO = novo; desenharPostosTudo(); if (forcar) aviso("Preços dos postos atualizados."); }
    } catch (e) {
      clearTimeout(t);
      st.textContent = PO ? "Não consegui buscar preços novos dos postos agora; mostrando os últimos guardados." : "Não consegui buscar os preços dos postos: " + e.message;
    }
  }

  function desenharPostosTudo() {
    const L = P && dadosDoLugar();
    if (L) { desenharPostos(L); desenharFontes(); }
  }

  function postosDaCidade(L) {
    if (!L || L.tipo !== "cidade" || !PO || poUF !== L.uf) return null;
    return PO.cidades[L.cidade.id.split("/")[1]] || [];
  }

  /** Postos da cidade com o combustível escolhido, já com local, distância e na ordem pedida. */
  function itensPostos(L, lista, c) {
    const cid = L.cidade.id.split("/")[1];
    const q = semAcento(filtroPosto.trim());
    const itens = lista.filter(p => p.p[c] && (!q || semAcento(p.nome + " " + nomePosto(p.nome) + " " + p.band).includes(q))).map(p => {
      const k = `${cid}|${p.nome}|${p.end}`;
      const l = LO && LO.postos && LO.postos[k];
      const ll = l ? [l[0], l[1]] : null;
      return { p, k, ll, aprox: l ? l[2] === "a" || l[2] === "r" : false, dist: eu && ll ? metros(eu, ll) : null };
    });
    const porPreco = (a, b) => a.p.p[c][0] - b.p.p[c][0] || (b.p.p[c][1] > a.p.p[c][1] ? 1 : -1);
    if (ordemPostos === "perto" && eu) itens.sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12) || porPreco(a, b));
    else itens.sort(porPreco);
    return itens;
  }

  function linkRota(it, L) {
    if (it.ll && !it.aprox) return `https://www.google.com/maps/dir/?api=1&destination=${it.ll[0]},${it.ll[1]}`;
    const busca = [nomePosto(it.p.nome), it.p.end, it.p.bairro, `${L.cidade.nome} - ${L.uf}`].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`;
  }

  function cartaoPosto(it, c, minimo, L, compacto) {
    const p = it.p, [v, d] = p.p[c] || [];
    const onde = [bonito(endLimpo(p.end)), bonito(p.bairro)].filter(Boolean).join(" · ");
    const outros = compacto ? "" : ORDEM_OUTROS.filter(k => k !== c && p.p[k]).map(k => `${NOME_COMB[k]} <b>${reais(p.p[k][0])}</b>`).join(" · ");
    const barato = v != null && v === minimo;
    return `<li class="posto${barato ? " barato" : ""}" data-k="${esc(it.k)}">
      <div class="posto-cab"><span class="nome">${esc(nomePosto(p.nome))}</span>
        <span class="valor"><b>${reais(v)}</b><small>${d ? "visto em " + dataCurtaBR(d) : ""}</small></span></div>
      <div class="end">${esc(onde)}</div>
      ${it.dist != null ? `<div class="dist">📏 ${distTxt(it.dist)} de você</div>` : ""}
      <div class="selos">${barato ? '<span class="selo barato">Mais barato</span>' : ""}<span class="selo">${esc(bandeira(p.band))}</span></div>
      ${outros ? `<div class="outros">${outros}</div>` : ""}
      <a class="rota" href="${esc(linkRota(it, L))}" target="_blank" rel="noopener">📍 Como chegar</a>
    </li>`;
  }

  function cartaoCarrossel(it, c, minimo, L) {
    const p = it.p, [v, d] = p.p[c];
    const cor = COR_BANDEIRA[p.band] || "#3b4250";
    return `<div class="posto-card${it.k === selPosto ? " sel" : ""}" role="listitem" tabindex="0" data-k="${esc(it.k)}">
      <div class="faixa" style="background:${cor}"><span>${esc(bandeira(p.band))}</span>${v === minimo ? "<span>★ Mais barato</span>" : ""}</div>
      <div class="corpo">
        <span class="nome">${esc(nomePosto(p.nome))}</span>
        <span class="preco-card">${reais(v)}<small>visto em ${dataCurtaBR(d)}</small></span>
        <span class="end">${esc(bonito(endLimpo(p.end)))}</span>
        <span class="dist">${it.dist != null ? `📏 ${distTxt(it.dist)} de você` : it.ll ? (it.aprox ? "Local aproximado no mapa" : "") : "Sem local no mapa"}</span>
        <a class="rota" href="${esc(linkRota(it, L))}" target="_blank" rel="noopener">📍 Como chegar</a>
      </div></div>`;
  }

  function desenharPostos(L) {
    $$("[data-comb]").forEach(b => b.setAttribute("aria-pressed", b.dataset.comb === comb));
    $$("[data-ordem-postos]").forEach(b => b.setAttribute("aria-pressed", b.dataset.ordemPostos === (ordemPostos === "perto" && eu ? "perto" : "preco")));
    const tit = $("#t-postos"), sub = $("#postos-sub"), res = $("#postos-resumo"), box = $("#postos");
    const cidade = L.tipo === "cidade";
    $("#escolha-comb").hidden = !cidade;
    $("#busca-postos-linha").hidden = !cidade;
    const esconderExtras = () => { $("#mapa-postos").hidden = true; $("#mapa-nota").hidden = true; $("#bloco-carrossel").hidden = true; $("#cab-lista").hidden = true; };
    if (!cidade) {
      esconderExtras();
      tit.textContent = "Postos";
      box.innerHTML = "";
      if (L.tipo === "carregando") { sub.textContent = "Carregando…"; res.innerHTML = ""; return; }
      sub.textContent = "Os preços por posto são de cada cidade. Busque a sua cidade lá em cima"
        + (L.tipo === "uf" ? " ou escolha uma das cidades que a ANP pesquisa:" : ".");
      const cids = L.tipo === "uf" && M ? M.lista.filter(c => c.uf === L.uf).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) : [];
      res.innerHTML = cids.length ? `<div class="cidades-postos">${cids.map(c => `<span class="chip"><button type="button" data-lugar="${esc(c.id)}">${esc(c.nome)}</button></span>`).join("")}</div>` : "";
      return;
    }
    tit.textContent = `Postos de ${L.cidade.nome}`;
    const lista = postosDaCidade(L);
    if (!lista || !lista.length) {
      esconderExtras();
      sub.textContent = !lista ? (poErro || "Carregando os preços dos postos…") : `A ANP não visitou postos de ${L.cidade.nome} nas últimas 4 semanas.`;
      res.innerHTML = ""; box.innerHTML = ""; return;
    }
    const per = PO.periodo || {};
    const velho = per.ate && diasDesde(per.ate) > 14 ? ` ⚠ A pesquisa mais recente é de ${dataBR(per.ate)}.` : "";
    sub.textContent = `${lista.length} ${lista.length === 1 ? "posto visitado" : "postos visitados"} pela ANP de ${dataCurtaBR(per.de)} a ${dataBR(per.ate)}.${velho}`;
    const todos = itensPostos(L, lista, comb);
    const sem = lista.filter(p => !p.p[comb]).length;
    let r = "";
    const vs = todos.map(i => i.p.p[comb][0]);
    const min = vs.length ? Math.min(...vs) : null, max = vs.length ? Math.max(...vs) : null;
    if (todos.length) {
      if (todos.length > 1 && max > min) r += `<p class="linha">Mais barato <b>${reais(min)}</b> · mais caro <b>${reais(max)}</b>. Num tanque de 50 litros, a diferença é de <b>${reais((max - min) * 50)}</b>.</p>`;
      if (comb === "gasolina" || comb === "etanol") {
        const g = mediana(lista.filter(p => p.p.gasolina).map(p => p.p.gasolina[0])), e = mediana(lista.filter(p => p.p.etanol).map(p => p.p.etanol[0]));
        if (g && e) {
          const x = e / g;
          r += `<p class="linha">⚖️ Aqui o etanol custa <b>${pct(x)}</b> do preço da gasolina: para carro flex, ${x <= 0.7 ? "<b>o etanol compensa mais</b>" : "<b>a gasolina compensa mais</b>"} (regra dos 70%, veja em "Entenda").</p>`;
        }
      }
    } else r = filtroPosto.trim()
      ? `<p class="linha">Nenhum posto com "${esc(filtroPosto.trim())}" no nome tem preço de ${NOME_COMB[comb].toLowerCase()}.</p>`
      : `<p class="linha">Nenhum posto de ${esc(L.cidade.nome)} teve preço de ${NOME_COMB[comb].toLowerCase()} nesta pesquisa.</p>`;
    res.innerHTML = r ? `<div class="resumo-postos">${r}</div>` : "";
    const perto = ordemPostos === "perto" && eu;
    $("#bloco-carrossel").hidden = !todos.length;
    $("#t-carrossel").textContent = perto ? "Mais perto de você" : "Mais baratos";
    $("#carrossel").innerHTML = todos.map(it => cartaoCarrossel(it, comb, min, L)).join("");
    $("#cab-lista").hidden = !todos.length;
    const mostrar = postosTodos ? todos : todos.slice(0, 10);
    box.innerHTML = mostrar.map(it => cartaoPosto(it, comb, min, L, false)).join("")
      + (todos.length > 10 ? `<li class="mais"><button type="button" data-mais="postos">${postosTodos ? "Mostrar menos" : `Ver os ${todos.length} postos`}</button></li>` : "")
      + (sem && !filtroPosto.trim() ? `<li class="mais carregando">${sem === 1 ? "1 posto" : sem + " postos"} sem preço de ${NOME_COMB[comb].toLowerCase()} nesta pesquisa.</li>` : "");
    desenharMapaPostos(L, todos, min);
  }

  // ---------------- o mini mapa (MapLibre + OpenFreeMap, gratuito; carregado só quando a aba Postos abre)

  let mapa = null, libMapa = null, estiloMapa = null, chaveEnquadre = null, marcadores = [], marcaEu = null, mapaFalhou = false;
  const ESTILO = () => (document.documentElement.dataset.tema === "escuro" || (document.documentElement.dataset.tema !== "claro" && matchMedia("(prefers-color-scheme: dark)").matches))
    ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/positron";

  function carregarLibMapa() {
    if (!libMapa) libMapa = new Promise((ok, erro) => {
      if (window.maplibregl) return ok(window.maplibregl);
      const s = document.createElement("script");
      s.src = "lib/maplibre-gl.js";
      s.onload = () => window.maplibregl ? ok(window.maplibregl) : erro(new Error("mapa não carregou"));
      s.onerror = () => erro(new Error("mapa não carregou"));
      document.head.appendChild(s);
    });
    return libMapa;
  }

  function notaMapa(t) { const n = $("#mapa-nota"); n.textContent = t || ""; n.hidden = !t; }

  async function desenharMapaPostos(L, itens, minimo) {
    const caixa = $("#mapa-postos");
    const comLocal = itens.filter(i => i.ll);
    const centro = LO && LO.centros && LO.centros[L.cidade.id.split("/")[1]];
    if (mapaFalhou || (!comLocal.length && !centro)) {
      caixa.hidden = true;
      notaMapa(mapaFalhou ? "O mapa não abriu neste aparelho (precisa de internet). A lista abaixo funciona normalmente."
        : LO ? "" : "O mapa aparece quando a localização dos postos estiver pronta.");
      return;
    }
    if (aba !== "postos") return;             // desenha quando a aba abrir (o mapa precisa estar visível)
    caixa.hidden = false;
    const fora = itens.length - comLocal.length;
    notaMapa(fora ? `${fora === 1 ? "1 posto ainda não tem" : fora + " postos ainda não têm"} local no mapa; aparece${fora === 1 ? "" : "m"} só na lista.` : "");
    let ml;
    try { ml = await carregarLibMapa(); } catch (e) { mapaFalhou = true; return desenharMapaPostos(L, itens, minimo); }
    try {
      if (!mapa) {
        estiloMapa = ESTILO();
        mapa = new ml.Map({ container: caixa, style: estiloMapa, center: centro ? [centro[1], centro[0]] : [comLocal[0].ll[1], comLocal[0].ll[0]],
          zoom: 12, attributionControl: false, cooperativeGestures: false, dragRotate: false, pitchWithRotate: false });
        mapa.touchZoomRotate.disableRotation();
        mapa.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
        mapa.addControl(new ml.AttributionControl({ compact: true }), "bottom-right");
        mapa.once("load", () => caixa.querySelectorAll(".maplibregl-compact-show").forEach(x => x.classList.remove("maplibregl-compact-show")));
        mapa.on("error", ev => { if (!navigator.onLine) notaMapa("Sem internet: o mapa não carrega, mas a lista abaixo funciona."); });
      } else if (estiloMapa !== ESTILO()) { estiloMapa = ESTILO(); mapa.setStyle(estiloMapa); }
      mapa.resize();
    } catch (e) { mapaFalhou = true; mapa = null; return desenharMapaPostos(L, itens, minimo); }
    marcadores.forEach(m => m.remove());
    marcadores = comLocal.slice().reverse().map(it => {       // o mais barato fica por cima
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pino" + (it.p.p[comb][0] === minimo ? " barato" : "") + (it.aprox ? " aprox" : "") + (it.k === selPosto ? " sel" : "");
      el.textContent = num(it.p.p[comb][0]);
      el.dataset.k = it.k;
      el.setAttribute("aria-label", `${nomePosto(it.p.nome)}: ${reais(it.p.p[comb][0])}`);
      el.addEventListener("click", ev => { ev.stopPropagation(); selecionarPosto(it.k, "mapa"); });
      return new ml.Marker({ element: el, anchor: "bottom" }).setLngLat([it.ll[1], it.ll[0]]).addTo(mapa);
    });
    if (marcaEu) { marcaEu.remove(); marcaEu = null; }
    if (eu) {
      const el = document.createElement("div"); el.className = "voce"; el.title = "Você está aqui";
      marcaEu = new ml.Marker({ element: el }).setLngLat([eu[1], eu[0]]).addTo(mapa);
    }
    const chave = `${L.cidade.id}|${comb}|${filtroPosto}|${eu ? "eu" : ""}`;
    if (chave !== chaveEnquadre) {
      chaveEnquadre = chave;
      // enquadra pelos postos com local bom; ponto aproximado muito longe dos outros não afasta o mapa
      let pts = comLocal.filter(i => !i.aprox).map(i => i.ll);
      if (pts.length < 3) pts = comLocal.map(i => i.ll);
      if (pts.length > 3) {
        const meio = [mediana(pts.map(p => p[0])), mediana(pts.map(p => p[1]))];
        const ds = pts.map(p => metros(meio, p)), lim = Math.max(3000, mediana(ds) * 3);
        pts = pts.filter((p, i) => ds[i] <= lim);
      }
      if (eu && (!pts.length || metros(eu, pts[0]) < 40000)) pts.push(eu);
      if (pts.length > 1) {
        const b = new ml.LngLatBounds();
        pts.forEach(p => b.extend([p[1], p[0]]));
        mapa.fitBounds(b, { padding: { top: 64, bottom: 34, left: 34, right: 72 }, maxZoom: 15, duration: 0 });
      } else if (pts.length === 1) mapa.jumpTo({ center: [pts[0][1], pts[0][0]], zoom: 14 });
      else if (centro) mapa.jumpTo({ center: [centro[1], centro[0]], zoom: 12 });
    }
  }

  function selecionarPosto(k, origem) {
    selPosto = k;
    $$(".pino").forEach(el => el.classList.toggle("sel", el.dataset.k === k));
    $$("#carrossel .posto-card").forEach(el => el.classList.toggle("sel", el.dataset.k === k));
    const card = $$("#carrossel .posto-card").find(el => el.dataset.k === k);
    if (origem === "mapa" && card) {
      const car = $("#carrossel");
      car.scrollTo({ left: card.offsetLeft - car.offsetLeft - 4, behavior: "smooth" });
    }
    if (origem !== "mapa" && mapa) {
      const m = marcadores.find(x => x.getElement().dataset.k === k);
      if (m) {
        const ll = m.getLngLat(), b = mapa.getBounds();
        if (!b.contains(ll)) mapa.easeTo({ center: ll, duration: 400 });
      }
    }
  }

  function pedirLocalizacao(depois) {
    if (!navigator.geolocation) { aviso("Este aparelho não informa a localização."); return; }
    const bt = $("#bt-perto");
    bt.disabled = true;
    notaMapa("⟳ Procurando onde você está…");
    navigator.geolocation.getCurrentPosition(pos => {
      bt.disabled = false;
      eu = [pos.coords.latitude, pos.coords.longitude];
      bt.setAttribute("aria-pressed", "true");
      ordemPostos = "perto"; postosTodos = false;
      notaMapa("");
      desenharPostos(dadosDoLugar());
      const L = dadosDoLugar(), c = L && L.tipo === "cidade" && LO && LO.centros && LO.centros[L.cidade.id.split("/")[1]];
      if (c && metros(eu, c) > 40000) aviso(`Você está longe de ${L.cidade.nome}: as distâncias são até onde você está agora.`);
      if (depois) depois();
    }, err => {
      bt.disabled = false;
      notaMapa("");
      aviso(err.code === 1
        ? "Sem permissão de localização. Para liberar: Configurações do celular → Apps → Gas → Permissões → Localização."
        : "Não consegui achar sua localização agora. Confira se a localização (GPS) do celular está ligada.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 });
  }

  // ------------------------------------------------------------ AGENDA

  function desenharEventos(L) {
    const preco = L.a ? L.a.preco : (L.cidade && L.cidade.p);
    const lista = P.eventos.filter(e => e.dias > -45);
    $("#eventos").innerHTML = lista.map(e => {
      const cenario = e.efeito && preco && e.dias >= 0 && e.status !== "aconteceu"
        ? `<div class="cenario">Em ${esc(L.nome)}: ${reais(preco)} → <b>${reais(preco + e.efeito)}</b> (se o resto ficar igual)</div>` : "";
      const nots = (e.noticias || []).map(n => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.titulo)}</a> <small>(${esc(n.fonte)})</small></li>`).join("");
      return `<li class="${e.status === "aconteceu" ? "passou" : ""}">${diaEvento(e.data)}
        <div><div class="tit">${esc(e.titulo)}</div>
          <div class="meta">${seloStatus(e)}${seloEfeito(e)}<span class="selo">${quandoEvento(e)}</span></div>
          ${cenario}
          ${e.noticia_alerta ? `<div class="alerta">📰 Saiu notícia que pode mudar este evento. Confira:<ul style="margin:4px 0 0;padding-left:18px">${nots}</ul></div>` : ""}
          <details><summary>Entenda</summary>${esc(e.explicacao)} ${e.fonte ? `<a href="${esc(e.fonte)}" target="_blank" rel="noopener">Fonte</a>` : ""}
          ${!e.noticia_alerta && nots ? `<ul style="margin:4px 0 0;padding-left:18px">${nots}</ul>` : ""}</details>
        </div></li>`;
    }).join("") || "<li>Nenhum evento no calendário.</li>";
  }

  function tempoAtras(seg) {
    const h = (Date.now() / 1000 - seg) / 3600;
    if (h < 1) return "agora há pouco";
    if (h < 24) return `há ${Math.round(h)} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  function desenharNoticias() {
    const todas = P.noticias || [];
    const etiquetas = ["Todas", ...new Set(todas.flatMap(x => x.etiquetas || []))];
    if (!etiquetas.includes(filtroNoticia)) filtroNoticia = "Todas";
    $("#filtro-noticias").innerHTML = etiquetas.map(t => `<button type="button" data-filtro="${esc(t)}" aria-pressed="${t === filtroNoticia}">${esc(t)}</button>`).join("");
    const n = filtroNoticia === "Todas" ? todas : todas.filter(x => (x.etiquetas || []).includes(filtroNoticia));
    $("#noticias").innerHTML = n.length ? n.slice(0, noticiasTodas ? 30 : 8).map(x => `<li><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.titulo)}</a>
      <div class="meta"><span>${esc(x.fonte)}</span><span>· ${tempoAtras(x.quando)}</span>${(x.etiquetas || []).map(t => `<span class="selo">${esc(t)}</span>`).join("")}</div></li>`).join("")
      + (n.length > 8 ? `<li class="mais"><button type="button" class="link-aba" data-mais="noticias">${noticiasTodas ? "Mostrar menos" : `Ver mais ${Math.min(30, n.length) - 8} notícias`}</button></li>` : "")
      : '<li class="carregando">Sem notícias no momento.</li>';
  }

  // ------------------------------------------------------------ SOBRE

  function desenharMetodo() {
    const m = P.modelo, t = m.teste_ultimo_ano, v = m.ao_vivo;
    const linhas = m.tabela.faixas.map(f => `<tr><td>${esc(f.nome)}</td><td class="num">${f.de == null ? "até " + sinal(f.ate) : f.ate == null ? "mais de " + sinal(f.de) : sinal(f.de) + " a " + sinal(f.ate)}</td>
      <td class="num">${f.casos}</td><td class="num">${pct(f.sobe)}</td><td class="num">${pct(f.igual)}</td><td class="num">${pct(f.desce)}</td></tr>`).join("");
    $("#metodo").innerHTML = `
      <ol>
        <li><span><b>Custo de agora</b>Toda semana a ANP publica quanto custam a gasolina das refinarias, o etanol e os impostos em cada litro.</span></li>
        <li><span><b>Comparação</b>Comparamos com o custo e o preço de ${m.ref[0]} a ${m.ref[1]} semanas atrás. Se o custo subiu mais do que o posto já subiu, "falta repassar".</span></li>
        <li><span><b>Chance</b>Procuramos, desde 2024, todas as semanas e Estados em que a conta deu parecido e contamos o que aconteceu nas ${m.horizonte} semanas seguintes.</span></li>
        <li><span><b>Datas marcadas</b>Impostos e regras com data e valor conhecidos entram à parte, pelo valor. São o sinal mais forte.</span></li>
      </ol>
      <h3>Quanto acerta</h3>
      ${t ? `<div class="blocos">
        <div class="bloco"><span>Quando avisou alta, subiu</span><b>${pct(t.avisos_alta_certos)}</b><small>das vezes (${t.avisos_alta} avisos)</small></div>
        <div class="bloco"><span>Sem aviso, sobe</span><b>${pct(t.alta_normal)}</b><small>das vezes</small></div></div>
        <p>Teste feito semana a semana nos últimos 12 meses (desde ${dataBR(t.desde)}), usando só o que se sabia em cada semana. No geral, as chances do app erram ${pct(t.melhora_sobre_media, 1)} menos do que usar só a média. É uma melhora pequena e real: o preço anda em degraus, por decisões da Petrobras, do governo e dos postos.</p>`
        : "<p>Ainda sem dados suficientes para medir.</p>"}
      <p>Previsões gravadas ao vivo desde ${dataBR(v.desde)}: ${v.casos ? `${v.casos} conferidas, acerto do mais provável ${pct(v.acerto)}` : "ainda aguardando as semanas seguintes para conferir"}.</p>
      <details><summary>Ver a tabela de chances</summary>
        <div class="rolagem"><table><thead><tr><th>Situação</th><th class="num">Falta repassar</th><th class="num">Casos</th><th class="num">Subiu</th><th class="num">Ficou</th><th class="num">Caiu</th></tr></thead>
        <tbody>${linhas}<tr><td><b>Normal (todas)</b></td><td></td><td class="num">${m.tabela.casos}</td><td class="num">${pct(m.tabela.normal.sobe)}</td><td class="num">${pct(m.tabela.normal.igual)}</td><td class="num">${pct(m.tabela.normal.desce)}</td></tr></tbody></table></div>
      </details>
      <h3>Limites</h3>
      <ul>
        <li>A ANP pesquisa uma amostra de postos (cerca de 4.500 por semana). Cidades pequenas entram com poucos postos.</li>
        <li>Subsídios, desonerações e reajustes podem ser anunciados de um dia para o outro.</li>
        <li>Na cidade, a conta usa os custos nacionais; frete e concorrência locais aparecem só no preço.</li>
        <li>O app não recebe dados de nenhum posto nem de você. Nada é guardado fora do seu aparelho.</li>
      </ul>`;
  }

  function desenharFontes() {
    const icone = f => !f.ok ? ["Falhou", "var(--critico)"] : f.atrasada ? ["Atrasada", "var(--atencao)"] : ["Funcionando", "var(--ok)"];
    $("#fontes").innerHTML = P.fontes.map(f => {
      const [t, c] = icone(f);
      return `<li><span>${esc(f.nome)}</span><span class="status"><i style="background:${c}"></i>${t}</span>
        <small>Dado mais novo: ${dataBR(f.data_dado && f.data_dado.slice(0, 10))}${f.ok ? (f.fonte ? " · via " + esc(f.fonte) : "") : " · " + esc(f.erro || "")}</small></li>`;
    }).join("") + `<li><span>Preço por posto (ANP, dados abertos)</span><small>${PO && PO.periodo && PO.periodo.ate ? `Postos visitados de ${dataBR(PO.periodo.de)} a ${dataBR(PO.periodo.ate)}. ` : ""}A ANP publica uma vez por semana os preços anotados em cada posto nas últimas 4 semanas.</small></li>`
      + `<li><small>Se uma fonte falhar, o app continua com o último dado bom dela e avisa no Resumo.</small></li>`;
  }

  // ------------------------------------------------------------ "Entenda": explicação curta de cada bloco

  // h = semanas da previsão; l = limite (R$) para contar como subir/cair
  const EXPLICA = {
    preco: () => `É o preço médio do litro da gasolina comum. Quem mede é a <b>ANP</b> (Agência Nacional do Petróleo, o órgão do governo que fiscaliza os combustíveis): toda semana ela pesquisa cerca de 4.500 postos no país. O posto onde você abastece pode cobrar um pouco mais ou um pouco menos. A barrinha mostra o posto mais barato e o mais caro encontrados aqui, e a bolinha é a média.`,
    previsao: (h, l) => `Não é um valor exato: é a <b>chance</b> de o preço mudar nas próximas ${h} semanas. "Subir" quer dizer ficar mais de ${l} mais caro por litro; "cair", mais de ${l} mais barato.<br><br>O <b>tracinho</b> em cada barra é o normal, ou seja, o que costuma acontecer numa semana qualquer. Se a barra passa do tracinho, aquilo está mais provável que o normal.<br><br>Exemplo: "Subir 30%" quer dizer que, em situações parecidas no passado, o preço subiu em 3 de cada 10 vezes.`,
    motivos: () => `São os fatores que mais pesam no preço agora, um por linha. O ícone <b>vermelho</b> empurra o preço para cima; o <b>azul</b> empurra para baixo; o cinza não empurra para nenhum lado.`,
    datas: () => `São decisões que já têm data marcada, do governo, da Petrobras ou do mercado. "<b>Confirmado</b>": vai acontecer. "<b>Pode mudar</b>": ainda depende de uma decisão. O valor em vermelho ou azul mostra quanto o litro muda se acontecer. Essas datas são o que mais mexe no preço.`,
    composicao: () => `A gasolina do posto é uma mistura: cerca de 2/3 de <b>gasolina pura</b>, que sai das refinarias (o nome técnico é "gasolina A"), e 1/3 de <b>etanol</b>, o álcool da cana ou do milho (o nome técnico é "etanol anidro", porque não tem água).<br><br>Por cima disso entram os impostos: os do governo federal (PIS/Cofins e Cide) e o do Estado (ICMS, hoje um valor fixo por litro, igual no país todo). O resto paga o transporte, a distribuidora e o posto.`,
    conta: () => `Quando um custo sobe (a refinaria reajusta, o etanol encarece, um imposto volta), o posto não muda o preço no mesmo dia: o aumento chega à bomba aos poucos, em algumas semanas. Com a queda acontece o mesmo.<br><br>Aqui comparamos <b>quanto os custos mudaram</b> com <b>quanto o preço do posto já mudou</b>. A diferença é o que "<b>falta chegar à bomba</b>". Se for positiva, o preço tende a subir; se for negativa, há espaço para cair.`,
    importacao: () => `O Brasil não produz toda a gasolina que usa: uma parte vem de fora. O <b>preço da importada</b> é quanto custaria trazer um litro do exterior hoje (a ANP chama de "PPI", Preço de Paridade de Importação).<br><br>Quando as refinarias daqui vendem <b>bem mais barato</b> que a importada, a Petrobras tende a aumentar o preço, e quem importa para de comprar, porque teria prejuízo. Quando vendem <b>mais caro</b>, há espaço para baixar.`,
    mercado: () => `<b>Petróleo (Brent)</b>: o preço do barril de petróleo no mercado mundial, em dólar. Um barril tem 159 litros. "Brent" é o nome do petróleo usado como referência.<br><b>Dólar</b>: o petróleo é comprado e vendido em dólar. Quando o dólar sobe, a gasolina importada fica mais cara em reais, mesmo que o petróleo não mude.<br><b>Etanol da mistura</b>: o álcool que vai dentro da gasolina. O preço muda com a safra da cana.<br><b>Gasolina das refinarias</b>: quanto as refinarias cobram, em média, pelo litro da gasolina pura.<br><br>A variação de 30 dias mostra para que lado cada um andou no último mês.`,
    graficos: () => `Mostram como cada valor mudou com o tempo. Encoste o dedo (ou passe o mouse) na linha para ver o valor de cada data. Os botões de cima trocam o gráfico; os de baixo mudam o período.`,
    mapa: () => `Cada quadrado é um Estado, colocado mais ou menos onde ele fica no mapa do Brasil.<br><b>Previsão</b>: a cor mostra a chance de o preço subir. Vermelho = mais que o normal; azul = menos; cinza = normal. O número é a chance de subir.<br><b>Preço</b>: azul mais escuro = gasolina mais cara.<br>Toque num Estado para ver o resumo dele.`,
    ranking: () => `Os Estados em ordem: do mais barato para o mais caro, ou do que tem mais chance de subir para o que tem menos. Toque num Estado para ver os detalhes dele.`,
    cidades: () => `A ANP não pesquisa todas as cidades do país: são cerca de 460, as maiores de cada região. Se a sua não aparece, use a média do Estado. Toque numa cidade para ver o preço e a previsão dela.`,
    calendario: () => `Datas que mudam o preço da gasolina. Por exemplo: o fim de um desconto em impostos (a "<b>desoneração</b>", quando o governo deixa de cobrar um imposto por um tempo), reuniões da <b>OPEP+</b> (o grupo de países que decide quanto petróleo produzir) ou a <b>entressafra</b> da cana (a época sem colheita, quando o etanol costuma ficar mais caro). Toque em "Entenda" em cada data para ver os detalhes.`,
    postos: () => `São os preços que a <b>ANP</b> anotou em cada posto quando foi pesquisar, nas últimas 4 semanas. Ela não visita todos os postos da cidade, só uma parte. O preço é o do <b>dia da visita</b> (aparece embaixo do valor): o posto pode ter mudado depois. Use como guia de onde costuma ser mais barato.<br><br><b>Bandeira</b> é a marca do posto. <b>Bandeira branca</b> é o posto sem marca, que pode comprar de qualquer distribuidora.<br><br><b>Etanol ou gasolina?</b> No carro flex, o etanol rende menos: cerca de 70% do que a gasolina rende. Por isso ele só compensa se custar <b>até 70%</b> do preço da gasolina.<br><br><b>No mapa</b>, cada etiqueta é um posto com o preço; a verde é a mais barata. Toque numa etiqueta para ver o posto nos cartões, ou deslize os cartões para ver o posto no mapa. Etiqueta com borda tracejada = <b>local aproximado</b> (achamos só a rua ou o bairro).<br><br>O botão de <b>seta</b> (ao lado da busca) usa a sua localização para mostrar os postos mais perto e a distância até cada um. Ela fica só no seu celular, não é guardada nem enviada a ninguém.<br><br>"Como chegar" abre o caminho no mapa do celular.`,
    noticias: () => `Manchetes dos últimos dias sobre combustíveis, tiradas do Google Notícias. Elas <b>não entram na conta</b> da previsão, mas servem de alerta: quando a Petrobras anuncia um reajuste, ele costuma chegar à bomba em 1 a 3 semanas.`,
  };

  const GLOSSARIO = [
    ["ANP", "Agência Nacional do Petróleo, Gás Natural e Biocombustíveis. É o órgão do governo que fiscaliza os combustíveis e pesquisa os preços nos postos toda semana."],
    ["Gasolina A (gasolina pura)", "A gasolina como sai da refinaria, antes de receber o etanol. Ninguém compra assim no posto."],
    ["Gasolina C (gasolina comum)", "A que você compra no posto: gasolina pura misturada com etanol."],
    ["Etanol anidro", "O álcool misturado à gasolina (hoje 32% do litro). \"Anidro\" quer dizer sem água. É diferente do etanol que se põe direto no tanque."],
    ["Refinaria", "A fábrica que transforma petróleo em gasolina, diesel e outros produtos. A maior parte das refinarias do Brasil é da Petrobras."],
    ["Refinaria privada", "Refinaria que não é da Petrobras (ex.: Acelen, na Bahia). Costuma mudar o preço mais vezes, seguindo o mercado mundial."],
    ["Reajuste", "Mudança de preço anunciada pela refinaria, para cima ou para baixo."],
    ["Importada (PPI)", "Quanto custaria trazer o litro de gasolina de fora do país. PPI quer dizer Preço de Paridade de Importação."],
    ["Petróleo Brent", "O preço do barril de petróleo usado como referência no mundo. Um barril tem 159 litros."],
    ["Dólar", "A moeda em que o petróleo é negociado. Dólar mais alto deixa o combustível importado mais caro em reais."],
    ["ICMS", "Imposto cobrado pelos Estados. Na gasolina, hoje é um valor fixo por litro, igual em todo o país."],
    ["PIS/Cofins e Cide", "Impostos do governo federal sobre os combustíveis."],
    ["Desoneração", "Quando o governo deixa de cobrar um imposto, ou cobra menos, por um tempo. Quando acaba, o preço sobe."],
    ["OPEP+", "Grupo de países que produzem petróleo (Arábia Saudita, Rússia e outros). Quando decidem produzir menos, o petróleo tende a ficar mais caro."],
    ["Safra e entressafra", "Safra é a época de colheita da cana, quando sobra etanol e ele fica mais barato. Na entressafra, sem colheita, ele tende a encarecer."],
    ["Repassar", "Passar um aumento ou uma redução de custo para o preço cobrado do cliente."],
    ["Falta chegar à bomba", "A parte da mudança dos custos que os postos ainda não passaram para o preço. Tende a aparecer nas semanas seguintes."],
    ["Bandeira", "A marca do posto. Vibra = postos Petrobras; Raízen = postos Shell."],
    ["Bandeira branca", "Posto sem marca: pode comprar combustível de qualquer distribuidora."],
    ["Diesel S10", "Diesel com menos enxofre (10 partes por milhão). É o exigido pelos carros e caminhões mais novos. O diesel comum (S500) tem mais enxofre."],
    ["Regra dos 70% (etanol ou gasolina)", "No carro flex, o etanol rende cerca de 70% do que a gasolina rende. Se o litro do etanol custar até 70% do litro da gasolina, ele compensa; acima disso, a gasolina compensa."],
    ["Chance (probabilidade)", "Quantas vezes, de cada 100 situações parecidas no passado, uma coisa aconteceu. 30% = 30 de cada 100 vezes."],
  ];

  let explicacoesProntas = false;
  function montarExplicacoes() {
    if (explicacoesProntas || !P) return;
    explicacoesProntas = true;
    const h = P.modelo.horizonte, l = reais(P.modelo.limiar);
    $$("[data-explica]").forEach((card, i) => {
      const f = EXPLICA[card.dataset.explica];
      if (!f) return;
      const titulo = card.querySelector("h2, .rotulo");
      const linha = document.createElement("div");
      linha.className = "titulo-linha";
      titulo.replaceWith(linha);
      linha.appendChild(titulo);
      const bt = document.createElement("button");
      bt.type = "button";
      bt.className = "bt-entenda";
      bt.setAttribute("aria-expanded", "false");
      bt.setAttribute("aria-controls", "explica-" + i);
      bt.innerHTML = '<span aria-hidden="true">?</span>Entenda';
      linha.appendChild(bt);
      const painel = document.createElement("div");
      painel.className = "painel-explica";
      painel.id = "explica-" + i;
      painel.hidden = true;
      painel.innerHTML = `<p>${f(h, l)}</p><button type="button" class="fechar-explica">Fechar</button>`;
      const cab = linha.parentElement.classList.contains("cab-cartao") ? linha.parentElement : linha;
      cab.after(painel);
    });
    $("#glossario").innerHTML = GLOSSARIO.map(([t, d]) => `<details><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`).join("");
  }

  function alternarExplicacao(bt, abrir) {
    const painel = document.getElementById(bt.getAttribute("aria-controls"));
    const aberto = abrir == null ? bt.getAttribute("aria-expanded") !== "true" : abrir;
    bt.setAttribute("aria-expanded", aberto);
    painel.hidden = !aberto;
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
      escolher(itens[i].id, aba !== "postos");
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
    let texto = "Gas: o preço do combustível vai subir ou cair? Preço, previsão, postos e os motivos.";
    if (L && L.a) texto = `Gasolina em ${L.nome}: ${reais(L.a.preco)}. ${(TEXTO_VEREDITO[L.a.veredito] || TEXTO_VEREDITO.incerto)[1]} nas próximas ${P.modelo.horizonte} semanas. Veja os motivos:`;
    if (local && !(P && P.endereco_publico)) {
      aviso("Este endereço só funciona no seu PC. Para mandar a outras pessoas, publique o app: gasolina publicar");
      return;
    }
    if (NATIVO) {
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

  const marcar = (sel, el) => $$(sel).forEach(x => x.setAttribute("aria-pressed", x === el));

  function ligarControles() {
    ligarBusca();
    document.addEventListener("click", e => {
      const ln = NATIVO && e.target.closest('a[target="_blank"]');
      if (ln) { e.preventDefault(); Nativo.abrirLink(ln.href); return; }
      const ab = e.target.closest("[data-aba]");
      if (ab) { mostrarAba(ab.dataset.aba); return; }
      const ir = e.target.closest("[data-ir]");
      if (ir) { mostrarAba(ir.dataset.ir); return; }
      const rm = e.target.closest("[data-remover]");
      if (rm) { removerAtalho(rm.dataset.remover); return; }
      const en = e.target.closest(".bt-entenda");
      if (en) { alternarExplicacao(en); return; }
      const fe = e.target.closest(".fechar-explica");
      if (fe) { const bt = document.querySelector(`[aria-controls="${fe.parentElement.id}"]`); alternarExplicacao(bt, false); bt.focus(); return; }
      const b = e.target.closest("[data-lugar]");
      if (b) { escolher(b.dataset.lugar, !b.closest("#atalhos, #aba-postos")); return; }
      const ac = e.target.closest("[data-acao]");
      if (ac && ac.dataset.acao === "atualizar-app") { instalarVersaoNova(ac); return; }
      if (ac && ac.dataset.acao === "dispensar-app") { versaoDispensada = true; $("#nova-versao").hidden = true; return; }
      const op = e.target.closest("[data-ordem-postos]");
      if (op) {
        if (op.dataset.ordemPostos === "perto" && !eu) { pedirLocalizacao(); return; }
        ordemPostos = op.dataset.ordemPostos; postosTodos = false; desenharPostos(dadosDoLugar()); return;
      }
      const pc = !e.target.closest("a") && e.target.closest("#carrossel .posto-card");
      if (pc) { selecionarPosto(pc.dataset.k, "card"); return; }
      const cb = e.target.closest("[data-comb]");
      if (cb) {
        comb = cb.dataset.comb; postosTodos = false;
        try { localStorage.setItem("gasolina.combustivel", comb); } catch (er) { }
        desenharPostos(dadosDoLugar()); return;
      }
      const mp = e.target.closest("[data-mapa]");
      if (mp) { modoMapa = mp.dataset.mapa; marcar("[data-mapa]", mp); desenharMapa(); return; }
      const o = e.target.closest("[data-ordem]");
      if (o) { ordem = o.dataset.ordem; marcar("[data-ordem]", o); desenharRanking(); return; }
      const ma = e.target.closest("[data-mais]");
      if (ma) {
        if (ma.dataset.mais === "ranking") { rankingTodos = !rankingTodos; desenharRanking(); }
        else if (ma.dataset.mais === "noticias") { noticiasTodas = !noticiasTodas; desenharNoticias(); }
        else if (ma.dataset.mais === "postos") { postosTodos = !postosTodos; desenharPostos(dadosDoLugar()); }
        else { cidadesTodas = !cidadesTodas; desenharCidades(dadosDoLugar()); }
        return;
      }
      const gr = e.target.closest("[data-grafico]");
      if (gr) { grafico = gr.dataset.grafico; marcar("[data-grafico]", gr); desenharGraficos(); return; }
      const pr = e.target.closest("[data-periodo]");
      if (pr) { periodo = +pr.dataset.periodo; marcar("[data-periodo]", pr); desenharGraficos(); return; }
      const fi = e.target.closest("[data-filtro]");
      if (fi) { filtroNoticia = fi.dataset.filtro; noticiasTodas = false; desenharNoticias(); return; }
      const te = e.target.closest("button[data-tema]");
      if (te) { aplicarTema(te.dataset.tema); desenharTudo(); return; }
    });
    document.addEventListener("keydown", e => {
      const li = e.target.closest && e.target.closest("li[data-lugar]");
      if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); escolher(li.dataset.lugar, true); }
    });
    $("#bt-compartilhar").addEventListener("click", compartilhar);
    $("#bt-perto").addEventListener("click", () => pedirLocalizacao());
    let tb;
    $("#busca-posto").addEventListener("input", e => { clearTimeout(tb); tb = setTimeout(() => { filtroPosto = e.target.value; postosTodos = false; desenharPostos(dadosDoLugar()); }, 200); });
    let tc;
    $("#carrossel").addEventListener("scroll", () => {          // deslizou os cartões: o posto da frente acende no mapa
      clearTimeout(tc);
      tc = setTimeout(() => {
        const car = $("#carrossel"), x = car.getBoundingClientRect().left;
        const prim = $$("#carrossel .posto-card").find(el => el.getBoundingClientRect().right > x + 40);
        if (prim && prim.dataset.k !== selPosto) selecionarPosto(prim.dataset.k, "card");
      }, 160);
    }, { passive: true });
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
            aviso(r === "negado" ? "O Android não deixou: libere as notificações do Gas nas Configurações." : "Não consegui ligar os lembretes agora.");
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
    // volta para a aba depois de horas: recarrega os dados (site)
    document.addEventListener("visibilitychange", () => {
      if (!NATIVO && document.visibilityState === "visible" && P && Date.now() - new Date(P.gerado_em).getTime() > 6 * 36e5) {
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
        buscarJSON("municipios.json").then(d => { M = d; desenharTudo(); }).catch(() => { });
      }
      const n = r.falhas.length;
      st.textContent = r.semInternet ? "Sem internet agora: mostrando os últimos dados guardados no celular."
        : n === 0 ? "✓ Atualizado agora, direto das fontes."
        : `Atualizado, mas ${n === 1 ? "uma fonte não respondeu" : n + " fontes não responderam"} (veja os avisos no topo).`;
      if (manual && !r.semInternet) aviso(n ? "Atualizado em parte." : "Atualizado.");
      if (poUF && !r.semInternet) atualizarPostosCelular(poUF, manual);
    } catch (e) {
      st.textContent = "Não consegui atualizar: " + e.message;
    } finally { bt.disabled = false; }
  }

  // Atualização do app Android (o mesmo jeito do Prumo; ver miolo.js)
  let versaoDispensada = false;
  function conferirVersaoApp() {
    const A = window.AtualizarApp;
    if (!A || !A.ativo) return;
    $("#cartao-atualizacoes").hidden = false;
    const ch = $("#ch-teste");
    ch.checked = A.recebeTeste();
    ch.addEventListener("change", () => {
      A.ligarTeste(ch.checked);
      aviso(ch.checked ? "Pronto: você vai receber as versões de teste." : "Pronto: só versões aprovadas daqui em diante.");
      A.conferir(true);
    });
    $("#bt-procurar-versao").addEventListener("click", async e => {
      e.target.disabled = true;
      const r = await A.conferir(true);
      e.target.disabled = false;
      aviso(!r ? "Não consegui falar com o GitHub agora. Confira a internet." : r.apk ? "Tem versão nova: veja o aviso no Resumo."
        : r.miolo ? "Versão nova baixada: ela entra na próxima vez que você abrir o app." : "O app já está na versão mais nova.");
    });
    A.aoMudar(desenharNovaVersao);
    desenharNovaVersao(null, null);
  }

  function desenharNovaVersao(nova, pronto) {
    const A = window.AtualizarApp, v = window.GASOLINA_APP || {};
    const base = A && A.nativo && A.nativo !== v.codigo ? ` (parte Android 1.${A.nativo})` : "";
    $("#versao-detalhe").textContent = `Versão instalada: ${v.versao || "—"}${base}.` + (pronto ? ` A versão ${pronto} já foi baixada e entra na próxima vez que você abrir o app.` : "");
    const div = $("#nova-versao");
    if (!nova || versaoDispensada) { div.hidden = true; return; }
    div.innerHTML = `📲 <b>Versão nova do app (${esc(nova.versao)}${nova.teste ? ", de teste" : ""})</b>${nova.notas ? ": " + esc(nova.notas) : ""}. Seus dados continuam.
      <span class="botoes-versao"><button type="button" class="bt" data-acao="atualizar-app">Atualizar</button>
      <button type="button" class="link-aba" data-acao="dispensar-app">Agora não</button></span>`;
    div.hidden = false;
  }

  async function instalarVersaoNova(bt) {
    bt.disabled = true; bt.textContent = "Baixando…";
    try {
      const r = await window.AtualizarApp.instalar();
      if (r === "permissao") aviso('Só da primeira vez: ligue "Permitir desta fonte" para o Gas, volte e toque em Atualizar de novo.');
    } catch (e) { aviso(e.message || "Não consegui baixar a versão nova. Confira a internet."); }
    bt.disabled = false; bt.textContent = "Atualizar";
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
