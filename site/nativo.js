/* Partes que só valem dentro do app Android (APK feito com Capacitor).
   No navegador, Nativo.ativo = false e nada daqui é usado.

   - Dados: o PRÓPRIO celular busca nas fontes (ANP, Banco Central, Ipeadata,
     Yahoo, Google Notícias) e recalcula a previsão, com o mesmo coletor do PC
     traduzido para JavaScript (coletor/coletor.mjs). Não depende de site nenhum.
     Tudo fica guardado no celular (IndexedDB); o APK traz uma base inicial
     (pasta base/) para funcionar desde a primeira abertura, mesmo sem internet.
   - Compartilhar: menu do Android (WhatsApp etc.).
   - Links de notícia: abrem no navegador do celular.
   - Lembretes: notificação na véspera e no dia das datas do calendário. */
(function () {
  "use strict";
  const C = window.Capacitor;
  const ativo = !!(C && C.isNativePlatform && C.isNativePlatform());
  const REMOTO = "https://pimentel-code.github.io/gasolina/";
  const EVENTOS_REMOTO = "https://raw.githubusercontent.com/pimentel-code/gasolina/main/eventos.json";
  const AGENTE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36";
  const plug = n => (C && C.Plugins && C.Plugins[n]) || null;
  const SAIDAS = ["painel.json", "historico.json", "municipios.json"];
  const BASE_ARQS = ["precos_ufs.json", "precos_brasil.json", "precos_municipios.json", "detalhe_ultima_semana.json",
    "sinteses.json", "sinteses_lidas.json", "mercado.json", "noticias.json", "fontes.json",
    "previsoes_registradas.json", "nomes_municipios.json", "controle.json"];

  // ------------------------------------------------------------ guardar no celular (IndexedDB)

  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((ok, erro) => {
      const r = indexedDB.open("gasolina", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("arquivos");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
    });
    return dbp;
  }
  async function lerIDB(chaves) {
    const d = await db();
    return new Promise((ok, erro) => {
      const t = d.transaction("arquivos", "readonly"), st = t.objectStore("arquivos"), out = {};
      for (const k of chaves) st.get(k).onsuccess = e => { out[k] = e.target.result; };
      t.oncomplete = () => ok(out);
      t.onerror = () => erro(t.error);
    });
  }
  async function gravarIDB(obj) {             // tudo numa transação só: ou grava tudo, ou nada
    const d = await db();
    return new Promise((ok, erro) => {
      const t = d.transaction("arquivos", "readwrite"), st = t.objectStore("arquivos");
      for (const [k, v] of Object.entries(obj)) st.put(v, k);
      t.oncomplete = () => ok();
      t.onerror = () => erro(t.error);
      t.onabort = () => erro(t.error || new Error("gravação cancelada (celular sem espaço?)"));
    });
  }

  async function local(caminho) {             // arquivo que veio dentro do APK
    const r = await fetch(caminho, { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // ------------------------------------------------------------ dados para a tela

  let origem = "embutido";      // "celular" = calculado aqui; "embutido" = veio com o APK

  /** Devolve { dados, origem } de painel/historico/municipios */
  async function buscar(nome) {
    let g = {};
    try { g = await lerIDB([nome, "meta"]); } catch (e) { }
    // o que foi calculado no celular vale se for mais novo que os dados que vieram no APK
    // (a comparação é sempre pelo painel, para os três arquivos ficarem da mesma rodada)
    let embPainel = null;
    try { embPainel = await local("dados/painel.json"); } catch (e) { }
    const embData = (embPainel && embPainel.gerado_em) || "";
    if (g[nome] && g.meta && g.meta.gerado_em >= embData) {
      if (nome === "painel.json") origem = "celular";
      return { dados: g[nome], origem: "celular" };
    }
    if (nome === "painel.json") origem = "embutido";
    return { dados: nome === "painel.json" && embPainel ? embPainel : await local("dados/" + nome), origem: "embutido" };
  }

  // ------------------------------------------------------------ atualizar pelas fontes

  function b64(s) {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function http(url, tipo, tempo) {
    const H = plug("CapacitorHttp");
    if (!H) throw new Error("HTTP nativo indisponível");
    const r = await H.request({
      url, method: "GET", responseType: tipo, connectTimeout: 20000, readTimeout: tempo * 1000,
      headers: { "User-Agent": AGENTE, "Accept": "*/*", "Accept-Language": "pt-BR,pt;q=0.9" },
    });
    if (r.status >= 400) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.data;
  }
  let pdfjs = null;
  const ambiente = (progresso) => ({
    texto: async (url, { tempo = 60 } = {}) => { const d = await http(url, "text", tempo); return typeof d === "string" ? d : JSON.stringify(d); },
    bytes: async (url, { tempo = 60 } = {}) => { const d = await http(url, "arraybuffer", tempo); return typeof d === "string" ? b64(d) : new Uint8Array(d); },
    pdfTexto: async bytes => {
      if (!pdfjs) {
        pdfjs = await import("./lib/pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("lib/pdf.worker.min.mjs", location.href).href;
      }
      const { pdfParaTexto } = await import("./coletor/pdf-texto.mjs");
      return pdfParaTexto(pdfjs, bytes);
    },
    log: m => console.log("[gasolina]", m),
    progresso,
    fatorEspera: 0.5,       // no celular, espera menos entre as tentativas
  });

  async function carregarBase() {
    const g = await lerIDB(["base", "base_apk"]);
    const apk = await local("base/controle.json").catch(() => ({}));
    const marcaApk = (apk && apk.ultima_execucao) || "";
    // base nova veio num APK novo (mais completa): recomeça dela
    if (g.base && g.base_apk === marcaApk) return g.base;
    const base = {};
    await Promise.all(BASE_ARQS.map(async f => { base[f] = await local("base/" + f).catch(() => ({})); }));
    if (g.base) {   // mantém o que o celular já aprendeu e o APK não tem
      const ult = o => Object.keys(o || {}).sort().pop() || "";
      if (ult(g.base["precos_brasil.json"]) > ult(base["precos_brasil.json"])) { g.base.__apk = marcaApk; return g.base; }
      base["previsoes_registradas.json"] = Object.assign({}, g.base["previsoes_registradas.json"], base["previsoes_registradas.json"]);
    }
    base.__apk = marcaApk;
    return base;
  }

  async function eventos() {
    try {   // calendário editado no PC (quando o projeto está publicado no GitHub)
      const d = JSON.parse(await http(EVENTOS_REMOTO + "?v=" + Math.floor(Date.now() / 36e5), "text", 10));
      if (d && Array.isArray(d.eventos)) { await gravarIDB({ eventos: d }); return d; }
    } catch (e) { }
    const g = await lerIDB(["eventos"]).catch(() => ({}));
    const apk = await local("base/eventos.json");
    // o do APK vale se for mais novo que o guardado (APK atualizado depois)
    const rev = d => (d.eventos || []).map(e => e.revisado_em || "").sort().pop() || "";
    return g.eventos && rev(g.eventos) >= rev(apk) ? g.eventos : apk;
  }

  async function temInternet() {
    for (const u of ["https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json", "https://www.gov.br/anp/pt-br"]) {
      try { await http(u, "text", 12); return true; } catch (e) { if (e.status) return true; }   // respondeu (mesmo com erro) = há internet
    }
    return false;
  }

  let rodando = null;
  /** Busca tudo nas fontes e recalcula. Devolve {falhas, ok}. */
  function atualizar(progresso = () => { }) {
    if (rodando) return rodando;
    rodando = (async () => {
      if (typeof DecompressionStream === "undefined")
        throw new Error("O navegador interno do Android está desatualizado. Atualize o \"Android System WebView\" na Play Store.");
      // sem internet: percebe em segundos, em vez de insistir em cada fonte
      if (navigator.onLine === false || !(await temInternet())) return { falhas: ["todas"], semInternet: true };
      const Col = await import("./coletor/coletor.mjs");
      progresso("Preparando…");
      const arquivos = await carregarBase();
      const marcaApk = arquivos.__apk;
      const base = {};
      for (const [k, f] of Object.entries(Col.ARQS)) base[k] = arquivos[f] || {};
      const cfg = await eventos();
      const emb = await local("dados/painel.json").catch(() => ({}));
      const r = await Col.atualizar(base, cfg, ambiente(progresso), { endereco_publico: emb.endereco_publico || REMOTO });
      // nenhuma fonte respondeu (sem internet): não mexe no que está guardado
      if (r.falhas.length >= Object.keys(Col.NOMES_FONTES).length) return { falhas: r.falhas, semInternet: true };
      progresso("Guardando no celular…");
      const novaBase = {};
      for (const [k, f] of Object.entries(Col.ARQS)) novaBase[f] = base[k];
      const g = { base: novaBase, meta: { gerado_em: r.saidas.painel.gerado_em, apk_gerado_em: emb.gerado_em || "", falhas: r.falhas } };
      if (marcaApk !== undefined) g.base_apk = marcaApk;
      for (const n of SAIDAS) g[n] = r.saidas[n.replace(".json", "")];
      await gravarIDB(g);
      return { falhas: r.falhas, painel: r.saidas.painel };
    })().finally(() => { rodando = null; });
    return rodando;
  }

  async function ultimaAtualizacao() {
    try { const g = await lerIDB(["meta"]); return g.meta ? new Date(g.meta.gerado_em) : null; } catch (e) { return null; }
  }

  // ------------------------------------------------------------ site publicado (só para o link de compartilhar)

  let siteNoAr = null;
  async function conferirSite() {
    if (siteNoAr !== null) return siteNoAr;
    try { const r = await fetch(REMOTO + "manifest.webmanifest", { method: "HEAD", cache: "no-store" }); siteNoAr = r.ok; }
    catch (e) { siteNoAr = false; }
    return siteNoAr;
  }

  async function compartilhar(titulo, texto, url) {
    const s = plug("Share");
    if (!s) return false;
    try { await s.share({ title: titulo, text: texto, url, dialogTitle: "Compartilhar" }); } catch (e) { }
    return true;
  }

  function abrirLink(url) {
    const b = plug("Browser");
    if (b) b.open({ url }); else window.open(url, "_blank");
  }

  // ---------------------------------------------------------------- lembretes

  const CHAVE = "gasolina.lembretes";
  const ligado = () => { try { return localStorage.getItem(CHAVE) === "1"; } catch (e) { return false; } };

  function idDe(texto, extra) {
    let h = 7;
    for (const c of texto) h = (h * 31 + c.charCodeAt(0)) % 900000;
    return 100000 + h * 2 + extra;
  }

  async function cancelarNossos(LN) {
    try {
      const pend = await LN.getPending();
      const nossos = (pend.notifications || []).filter(n => n.id >= 100000);
      if (nossos.length) await LN.cancel({ notifications: nossos.map(n => ({ id: n.id })) });
    } catch (e) { }
  }

  async function agendar(eventos, reais) {
    const LN = plug("LocalNotifications");
    if (!LN || !ligado()) return 0;
    await cancelarNossos(LN);
    const agora = Date.now();
    const lista = [];
    for (const e of eventos) {
      if (e.status === "aconteceu" || e.status === "cancelado") continue;
      const [a, m, d] = e.data.split("-").map(Number);
      const efeito = e.efeito ? ` ${e.status === "depende" ? "Se acontecer, " : ""}${e.efeito > 0 ? "pode subir" : "pode cair"} cerca de ${reais(Math.abs(e.efeito))} por litro.` : "";
      const vesp = new Date(a, m - 1, d - 1, 9, 0);
      const dia = new Date(a, m - 1, d, 9, 0);
      if (vesp.getTime() > agora) lista.push({ id: idDe(e.id, 0), title: "Amanhã: " + e.titulo, body: (efeito || "Data marcada no calendário da gasolina.").trim(), schedule: { at: vesp, allowWhileIdle: true } });
      if (dia.getTime() > agora) lista.push({ id: idDe(e.id, 1), title: "Hoje: " + e.titulo, body: (efeito || "Abra o app para ver o efeito no preço.").trim(), schedule: { at: dia, allowWhileIdle: true } });
    }
    if (lista.length) await LN.schedule({ notifications: lista.slice(0, 40) });
    return lista.length;
  }

  async function ligarLembretes(eventos, reais) {
    const LN = plug("LocalNotifications");
    if (!LN) return "sem-plugin";
    let p = await LN.checkPermissions();
    if (p.display !== "granted") p = await LN.requestPermissions();
    if (p.display !== "granted") return "negado";
    try { localStorage.setItem(CHAVE, "1"); } catch (e) { }
    await agendar(eventos, reais);
    return "ok";
  }

  async function desligarLembretes() {
    try { localStorage.removeItem(CHAVE); } catch (e) { }
    const LN = plug("LocalNotifications");
    if (LN) await cancelarNossos(LN);
  }

  function aoVoltar(cb) {
    const app = plug("App");
    if (app) app.addListener("resume", cb);
  }

  window.Nativo = {
    ativo, REMOTO, buscar, atualizar, ultimaAtualizacao, conferirSite, compartilhar, abrirLink, aoVoltar,
    lembretes: { ligado, ligar: ligarLembretes, desligar: desligarLembretes, agendar },
    get origem() { return origem; },
    get atualizando() { return !!rodando; },
    versao: window.GASOLINA_APP || null,
  };
  if (ativo) document.documentElement.classList.add("nativo");
})();
