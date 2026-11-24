/* miolo.js — o app Android do Gasolina se atualiza sozinho (o mesmo jeito do Prumo).

   O app tem duas partes:
   · a parte NATIVA (o APK: permissões, código Android): só muda instalando um APK novo;
   · o MIOLO (telas, cores, regras, HTML/CSS/JS): este arquivo troca sozinho, sem ninguém ver.

   Ao abrir (e ao voltar para o app), pergunta ao GitHub quais versões existem
   (no máximo a cada 30 min). Nenhum dado da pessoa sai do celular.
   · Miolo novo que serve para este APK → baixa o miolo.zip em segundo plano e troca quando
     o app vai para o fundo; quem abre de novo já vê a versão nova. Se o miolo novo não abrir
     direito em 10 s, a peça volta sozinha ao anterior. Os dados guardados não são tocados.
   · Versão que exige APK novo (marca "[nativo:N]" maior que o APK instalado) → faixa
     "Versão nova" com o botão Atualizar, que baixa o APK e abre o instalador do Android.
   Versões de TESTE (pré-lançamento no GitHub) só chegam a quem ligou "Receber versões de
   teste" na aba Sobre.

   Peça usada: @capgo/capacitor-updater em modo manual, sem a nuvem da Capgo. */
(function () {
  "use strict";
  const API = "https://api.github.com/repos/pimentel-code/gasolina/releases?per_page=20";
  const C = window.Capacitor;
  const plug = n => (C && C.Plugins && C.Plugins[n]) || null;
  const ativo = !!(C && C.isNativePlatform && C.isNativePlatform());
  const CHAVE_TESTE = "gasolina.versoes-teste";
  const CHAVE_VISTO = "gasolina.atualizacao.conferido";
  const INTERVALO = 30 * 60 * 1000;

  const codigoDe = tag => { const m = /^v?1\.(\d+)$/.exec(String(tag || "").trim()); return m ? +m[1] : 0; };
  const nativoDe = j => { const m = /\[nativo:(\d+)\]/.exec(String(j.body || "")); return m ? +m[1] : codigoDe(j.tag_name); };
  const notasDe = j => String(j.body || "").replace(/\[nativo:\d+\]/g, "").trim().slice(0, 300);

  /** Escolhe, numa lista de releases do GitHub, o miolo que dá para trocar sozinho e o APK que precisa ser instalado. */
  function escolher(lista, { miolo, nativo, teste }) {
    const ok = (lista || []).filter(j => j && !j.draft && (teste || !j.prerelease)).map(j => ({
      tag: j.tag_name, codigo: codigoDe(j.tag_name), nativo: nativoDe(j), notas: notasDe(j), teste: !!j.prerelease,
      zip: (j.assets || []).find(a => a.name === "miolo.zip"), apk: (j.assets || []).find(a => /\.apk$/i.test(a.name)),
    })).filter(x => x.codigo > 0).sort((a, b) => b.codigo - a.codigo);
    const m = ok.find(x => x.zip && x.codigo > miolo && x.nativo <= nativo) || null;
    const a = ok.find(x => x.apk && x.nativo > nativo) || null;
    return { miolo: m, apk: a };
  }

  const recebeTeste = () => { try { return localStorage.getItem(CHAVE_TESTE) === "sim"; } catch (e) { return false; } };
  function ligarTeste(sim) {
    try { localStorage.setItem(CHAVE_TESTE, sim ? "sim" : "nao"); localStorage.removeItem(CHAVE_VISTO); } catch (e) { }
  }

  let nativoInstalado = 0, nova = null, pronto = null, ouvintes = [];
  const avisar = () => ouvintes.forEach(f => { try { f(nova, pronto); } catch (e) { } });

  async function conferir(forcar) {
    if (!ativo) return null;
    try { nativoInstalado = +(await plug("App").getInfo()).build || 0; } catch (e) { return null; }
    let visto = 0;
    try { visto = +localStorage.getItem(CHAVE_VISTO) || 0; } catch (e) { }
    if (!forcar && Date.now() - visto < INTERVALO) return null;
    let lista;
    try {
      const r = await fetch(API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!r.ok) return null;
      lista = await r.json();
      localStorage.setItem(CHAVE_VISTO, String(Date.now()));
    } catch (e) { return null; }      // sem internet: tenta na próxima abertura
    const meu = (window.GASOLINA_APP && window.GASOLINA_APP.codigo) || 0;
    const r = escolher(lista, { miolo: meu, nativo: nativoInstalado, teste: recebeTeste() });
    nova = r.apk ? { versao: "1." + r.apk.codigo, url: r.apk.apk.browser_download_url, notas: r.apk.notas, teste: r.apk.teste } : null;
    if (r.miolo) await baixarMiolo(r.miolo);
    avisar();
    return r;
  }

  async function baixarMiolo(x) {
    const U = plug("CapacitorUpdater");
    if (!U) return;
    const nome = String(x.codigo);
    try {
      let pacote = null;
      try {
        const l = await U.list();
        const mesmo = (l.bundles || []).filter(b => b.version === nome);
        if (mesmo.some(b => b.status === "error")) return;     // já falhou neste celular: espera a próxima
        pacote = mesmo.find(b => b.status === "success" || b.status === "pending") || null;
      } catch (e) { }
      if (!pacote) pacote = await U.download({ version: nome, url: x.zip.browser_download_url });
      await U.next({ id: pacote.id });                          // troca quando o app for para o fundo
      pronto = "1." + nome;
    } catch (e) { /* falhou o download: tenta de novo mais tarde */ }
  }

  async function instalar() {
    const G = plug("Gasolina");
    if (!nova || !G) throw new Error("Atualização indisponível.");
    try {
      if (!(await G.podeInstalar()).pode) {
        await G.abrirPermissaoInstalar();
        return "permissao";
      }
    } catch (e) { /* aparelho antigo: segue */ }
    await G.instalarAtualizacao({ url: nova.url });
    return "ok";
  }

  function iniciar() {
    if (!ativo) return;
    const U = plug("CapacitorUpdater");
    if (U) U.notifyAppReady().catch(() => { });              // "este miolo abriu bem" (senão volta ao anterior)
    setTimeout(() => conferir(false), 4000);
    const app = plug("App");
    if (app) app.addListener("resume", () => conferir(false));
  }

  window.AtualizarApp = {
    ativo, escolher, conferir, instalar, recebeTeste, ligarTeste,
    aoMudar: f => { ouvintes.push(f); if (nova || pronto) f(nova, pronto); },
    get nativo() { return nativoInstalado; },
  };
  iniciar();
})();
