// Coletor do app Gasolina em JavaScript: a mesma lógica do coletor/*.py (Python),
// para rodar DENTRO do celular (app Android) e também no PC (Node, para testes).
//
// Não faz download nem grava nada sozinho: recebe um "ambiente" (amb) com
//   amb.texto(url, {tempo})  -> Promise<string>
//   amb.bytes(url, {tempo})  -> Promise<Uint8Array>
//   amb.pdfTexto(bytes)      -> Promise<string>   (páginas separadas por \f)
//   amb.log(msg), amb.progresso(msg)   (opcionais)
// e uma "base" (o mesmo conteúdo de dados/*.json do PC).
//
// Se mudar a regra aqui, mude também no Python (e vice-versa): o teste
// testes/coletor-js.mjs compara os dois.

// ====================================================================== util

export class FalhaFonte extends Error { }

export const semAcento = s => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export function dataExcel(v) {
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const n = Number(s);
  if (!s || !isFinite(n)) return null;
  return isoDeDias(Date.UTC(1899, 11, 30) / 864e5 + Math.trunc(n));
}

export function numero(v) {
  if (v == null) return null;
  let s = String(v).trim().replace("R$", "").replace("%", "").trim();
  if (!s || s === "-") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return s && isFinite(n) ? n : null;
}

const dataBr = s => { const [d, m, a] = s.split("/"); return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
const diasDe = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const isoDeDias = n => new Date(n * 864e5).toISOString().slice(0, 10);
const somaDias = (iso, n) => isoDeDias(diasDe(iso) + n);

// arredonda como o Python (meio para o par, sobre o valor binário) — na prática igual ao toFixed
export const arred = (x, c = 3) => x == null ? x : Number(Number(x).toFixed(c));
// soma exata, igual ao math.fsum do Python (o statistics.fmean usa ela): sem isso,
// casos na fronteira de uma faixa (ex.: exatamente R$ 0,20) caem do lado errado
function fsum(xs) {
  const p = [];
  for (let x of xs) {
    let i = 0;
    for (let y of p) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y, lo = y - (hi - x);
      if (lo) p[i++] = lo;
      x = hi;
    }
    p.length = i; p.push(x);
  }
  let n = p.length;
  if (!n) return 0;
  let hi = p[--n], lo = 0;
  while (n > 0) { const x = hi, y = p[--n]; hi = x + y; lo = y - (hi - x); if (lo) break; }
  if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) { const y = lo * 2, x = hi + y; if (y === x - hi) hi = x; }
  return hi;
}
const media = a => fsum(a) / a.length;
const mediana = a => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const maxChave = o => { let m = null; for (const k in o) if (m === null || k > m) m = k; return m; };
const chavesOrd = o => Object.keys(o).sort();

/** Hora de Brasília: {iso: "2026-11-22T21:12-03:00", dia: "2026-11-22", ts} */
export function agoraSP(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const off = Math.round((local - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  const sinal = off < 0 ? "-" : "+", a = Math.abs(off);
  return {
    iso: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}${sinal}${String(a / 60 | 0).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`,
    dia: `${p.year}-${p.month}-${p.day}`, ts: d.getTime() / 1000,
  };
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const desescapar = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e.toLowerCase()] ?? m));

async function baixar(amb, url, { tempo = 60, tentativas = 4, espera = 4, binario = true } = {}) {
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    try {
      return binario ? await amb.bytes(url, { tempo }) : await amb.texto(url, { tempo });
    } catch (e) {
      ultimo = e;
      if ([400, 401, 403, 404, 410].includes(e.status)) break;     // não adianta insistir
      if (t < tentativas) await new Promise(r => setTimeout(r, espera * 1000 * t * (amb.fatorEspera ?? 1)));
    }
  }
  throw new FalhaFonte(`${url} -> ${ultimo && ultimo.message}`);
}

// ====================================================================== xlsx

async function inflar(dados, metodo) {
  if (metodo === 0) return dados;
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([dados]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

function abrirZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new FalhaFonte("a planilha baixada não é um .xlsx válido");
  const n = dv.getUint16(fim + 10, true);
  let p = dv.getUint32(fim + 16, true);
  const arqs = {};
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + ln));
    arqs[nome] = { metodo, tam, loc };
    p += 46 + ln + le + lc;
  }
  return {
    nomes: Object.keys(arqs),
    async texto(nome) {
      const a = arqs[nome];
      if (!a) return null;
      const ini = a.loc + 30 + dv.getUint16(a.loc + 26, true) + dv.getUint16(a.loc + 28, true);
      return dec.decode(await inflar(b.subarray(ini, ini + a.tam), a.metodo));
    },
  };
}

const textoXml = s => desescapar((s.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || []).map(t => t.replace(/^<t[^>]*>|<\/t>$/g, "")).join(""));
const coluna = ref => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** {nome_da_aba: () => Promise<Array<linha>>} */
export async function planilhas(bytes) {
  const z = abrirZip(bytes);
  const ss = [];
  const sst = await z.texto("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(textoXml(m[1]));
  const wb = await z.texto("xl/workbook.xml"), rels = await z.texto("xl/_rels/workbook.xml.rels");
  const alvo = {};
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = (m[1].match(/\bId="([^"]+)"/) || [])[1], t = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id) alvo[id] = t;
  }
  const abas = {};
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nome = desescapar((m[1].match(/\bname="([^"]*)"/) || [])[1] || "");
    let t = (alvo[(m[1].match(/\br:id="([^"]+)"/) || [])[1]] || "").replace(/^\//, "");
    if (!t.startsWith("xl/")) t = "xl/" + t;
    abas[nome] = async () => {
      const xml = await z.texto(t);
      const linhas = [];
      for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        if (!r[1]) continue;
        const v = {};
        let max = -1, i = 0;
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const at = c[1], dentro = c[2] || "";
          const ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1];
          const tipo = (at.match(/\bt="([^"]+)"/) || [])[1];
          const vv = dentro.match(/<v>([\s\S]*?)<\/v>/);
          let val = null;
          if (vv) val = tipo === "s" ? ss[+vv[1]] : desescapar(vv[1]);
          else if (/<is>/.test(dentro)) val = textoXml(dentro);
          const col = ref ? coluna(ref) : i;
          v[col] = val; i = col + 1;
          if (col > max) max = col;
        }
        if (max >= 0) linhas.push(Array.from({ length: max + 1 }, (_, k) => v[k] ?? null));
      }
      return linhas;
    };
  }
  return abas;
}

/** Pula o cabeçalho decorativo da ANP (a linha com EXATAMENTE os nomes esperados). */
export async function tabela(pegar, chaves = ["PRODUTO", "DATA FINAL"]) {
  const linhas = await pegar();
  let cab = null;
  const out = [];
  for (const linha of linhas) {
    if (cab === null) {
      const textos = linha.map(x => x ? semAcento(x) : "");
      if (chaves.every(k => textos.includes(k))) cab = textos;
      continue;
    }
    const o = {};
    for (let i = 0; i < Math.min(cab.length, linha.length); i++) if (cab[i]) o[cab[i]] = linha[i];
    out.push(o);
  }
  if (cab === null) throw new FalhaFonte("cabeçalho da planilha não encontrado (formato mudou?)");
  return out;
}

// ====================================================================== ANP

const BASE_ANP = "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos";
const PAG_LPC = BASE_ANP + "/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas";
const PAG_SINTESE = BASE_ANP + "/sintese-semanal-do-comportamento-dos-precos-dos-combustiveis";

export const UFS = {
  "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM", "BAHIA": "BA", "CEARA": "CE", "DISTRITO FEDERAL": "DF",
  "ESPIRITO SANTO": "ES", "GOIAS": "GO", "MARANHAO": "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG",
  "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR", "PERNAMBUCO": "PE", "PIAUI": "PI", "RIO DE JANEIRO": "RJ",
  "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS", "RONDONIA": "RO", "RORAIMA": "RR", "SANTA CATARINA": "SC",
  "SAO PAULO": "SP", "SERGIPE": "SE", "TOCANTINS": "TO",
};
const PRODUTO = "GASOLINA COMUM";

async function links(amb, pagina, padrao) {
  const texto = await baixar(amb, pagina, { binario: false });
  const achados = [];
  for (const m of texto.matchAll(/href="([^"]+)"/g)) {
    let h = desescapar(m[1]);
    if (h.startsWith("/")) h = "https://www.gov.br" + h;
    if (padrao.test(h) && !achados.includes(h)) achados.push(h);
  }
  return achados;
}

export async function ultimosResumos(amb) {
  const saida = new Map();
  for (const u of await links(amb, PAG_LPC, /resumo.*\.xlsx/i)) {
    const m = u.match(/(\d{4})_(\d{2})_(\d{2})-(\d{4})_(\d{2})_(\d{2})/);
    if (m) saida.set(`${m[4]}-${m[5]}-${m[6]}|${u}`, [`${m[4]}-${m[5]}-${m[6]}`, u]);
  }
  if (!saida.size) throw new FalhaFonte("nenhum resumo semanal encontrado na página da ANP (página mudou?)");
  return [...saida.values()].sort((a, b) => (b[0] + b[1] > a[0] + a[1] ? 1 : -1));
}

export async function lerResumo(bytes) {
  const abas = await planilhas(bytes);
  const aba = chave => {
    for (const n of Object.keys(abas)) if (semAcento(n).startsWith(chave)) return abas[n];
    throw new FalhaFonte(`aba ${chave} sumiu do resumo semanal`);
  };
  const registro = r => ({
    p: numero(r["PRECO MEDIO REVENDA"]), min: numero(r["PRECO MINIMO REVENDA"]), max: numero(r["PRECO MAXIMO REVENDA"]),
    dp: numero(r["DESVIO PADRAO REVENDA"]), n: Math.trunc(numero(r["NUMERO DE POSTOS PESQUISADOS"]) || 0),
  });
  const out = { ufs: {}, municipios: {}, regioes: {}, brasil: null };
  for (const r of await tabela(aba("ESTADO"))) {
    if (semAcento(r["PRODUTO"]) !== PRODUTO) continue;
    const uf = UFS[semAcento(r["ESTADOS"] || r["ESTADO"])];
    if (uf) { out.ufs[uf] = registro(r); out.semana = dataExcel(r["DATA FINAL"]); out.inicio = dataExcel(r["DATA INICIAL"]); }
  }
  for (const r of await tabela(aba("MUNICIPIO"))) {
    if (semAcento(r["PRODUTO"]) !== PRODUTO) continue;
    const uf = UFS[semAcento(r["ESTADO"])];
    if (uf) out.municipios[`${uf}/${semAcento(r["MUNICIPIO"])}`] = registro(r);
  }
  for (const r of await tabela(aba("REGI"))) if (semAcento(r["PRODUTO"]) === PRODUTO) out.regioes[semAcento(r["REGIAO"])] = registro(r);
  for (const r of await tabela(aba("BRASIL"))) if (semAcento(r["PRODUTO"]) === PRODUTO) out.brasil = registro(r);
  const n = Object.keys(out.ufs).length;
  if (n < 25) throw new FalhaFonte(`resumo semanal veio com só ${n} Estados`);
  for (const [uf, v] of Object.entries(out.ufs)) if (!v.p || !(v.p > 2.5 && v.p < 15)) throw new FalhaFonte(`preço estranho para ${uf}: ${v.p}`);
  if (!out.brasil || !out.semana) throw new FalhaFonte("resumo semanal sem a média Brasil ou sem a data");
  return out;
}

export async function sintesesDisponiveis(amb, anoMin = 2024) {
  const saida = new Map();
  for (const u of await links(amb, PAG_SINTESE, /arq-sintese-semanal\/20\d\d\//i)) {
    const m = u.match(/arq-sintese-semanal\/(20\d\d)\/(.+)$/);
    if (!m || m[2].includes("comunicado")) continue;
    const ano = +m[1];
    const nums = m[2].replace(/20\d\d/g, "").match(/\d{1,2}(?!\d)/g);
    if (ano < anoMin || !nums) continue;
    saida.set(u, [ano, +nums[0], u]);
  }
  if (!saida.size) throw new FalhaFonte("nenhuma síntese semanal encontrada (página mudou?)");
  return [...saida.values()].sort(compTupla).reverse();
}
const compTupla = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

const _DATA = "(\\d{2}/\\d{2}/\\d{4})", _NUM = "(-?\\d{1,3}(?:\\.\\d{3})*,\\d+)";

export function lerSintese(texto) {
  const pag = texto.split("\f").find(p => p.toUpperCase().includes("REALIZA") && p.toUpperCase().includes("GASOLINA"));
  if (!pag) throw new FalhaFonte("síntese sem a página de gasolina/realização");
  const s = {};
  let m = texto.match(new RegExp("Semana de\\s+" + _DATA + "\\s+a\\s+" + _DATA));
  if (!m) throw new FalhaFonte("síntese sem a semana");
  s.inicio = dataBr(m[1]); s.semana = dataBr(m[2]);
  m = texto.match(/Edi[cç][aã]o\s+(\d+)\/(\d{4})/);
  s.edicao = m ? `${m[1]}/${m[2]}` : null;
  const sec = { revenda: {}, distribuicao: {}, realizacao: {}, ppi: {}, golfo: {}, anidro: {} };
  const grupo = new RegExp(_DATA + "\\s+" + _NUM + "%?\\s+" + _NUM + "%?", "g");
  let atual = null;
  for (const linha of pag.split(/\r?\n/)) {
    const u = semAcento(linha);
    if (u.includes("COMPOSICAO DO PRECO")) break;
    if (u.includes("REVENDA - SEMANA")) atual = "revenda";
    else if (u.includes("DISTRIBUICAO - SEMANA")) atual = "distribuicao";
    else if (u.includes("REALIZACAO")) atual = "realizacao";
    else if (u.includes("COTACAO INTERNACIONAL")) atual = "ppi";
    else if (u.includes("ETANOL ANIDRO") && !u.includes("COTACAO")) atual = "anidro";
    if (!atual) continue;
    const achados = [...linha.matchAll(grupo)];
    if (!achados.length) continue;
    const ordem = ["revenda", "distribuicao"].includes(atual) ? [atual] : achados.length > 1 ? ["realizacao", "ppi", "anidro"] : [atual];
    achados.slice(0, ordem.length).forEach((g, k) => {
      const d = dataBr(g[1]);
      if (ordem[k] === "ppi") { sec.golfo[d] = numero(g[2]); sec.ppi[d] = numero(g[3]); }
      else sec[ordem[k]][d] = numero(g[2]);
    });
  }
  Object.assign(s, sec);
  const i = texto.indexOf("Composição do preço");
  const j = i >= 0 ? texto.indexOf("Preços médios de revenda da gasolina", i) : -1;
  const bloco = i >= 0 ? texto.slice(i, j > 0 ? j : i + 6000) : "";
  const vals = [...bloco.matchAll(/(?<![|\s])\s+R\$\s*(\d+,\d{2})/g)].map(x => numero(x[1]));
  if (vals.length >= 6) {
    const [total, marg, est, fed, anid, gasA] = vals;
    if (Math.abs(marg + est + fed + anid + gasA - total) <= 0.03)
      s.composicao = { total, margens: marg, icms: est, federais: fed, anidro: anid, gasolina_a: gasA };
  }
  if (!s.composicao) throw new FalhaFonte("não reconheci a composição do preço na síntese (formato mudou?)");
  const faixas = { gasolina_a: [0.8, 6], anidro: [0.3, 3], icms: [0.5, 3], federais: [0, 2], margens: [0.2, 3.5], total: [3, 12] };
  for (const [k, [a, b]] of Object.entries(faixas)) if (!(s.composicao[k] >= a && s.composicao[k] <= b)) throw new FalhaFonte(`síntese: valor fora do normal em ${k}: ${s.composicao[k]}`);
  for (const k of ["realizacao", "ppi", "anidro"]) for (const [d, v] of Object.entries(s[k])) if (v == null || !(v > 0.5 && v < 10)) throw new FalhaFonte(`síntese: ${k} em ${d} = ${v}`);
  return s;
}

// ====================================================================== dólar, Brent

async function yahoo(amb, simbolo, faixa = "1mo") {
  let ultimo, j;
  for (const host of ["query2", "query1"]) {
    try { j = JSON.parse(await baixar(amb, `https://${host}.finance.yahoo.com/v8/finance/chart/${simbolo}?range=${faixa}&interval=1d`, { binario: false, tentativas: 2, espera: 8 })); break; }
    catch (e) { ultimo = e; }
  }
  if (!j) throw new FalhaFonte(`Yahoo indisponível: ${ultimo && ultimo.message}`);
  const r = j.chart.result[0], fech = r.indicators.quote[0].close, out = {};
  r.timestamp.forEach((t, i) => { if (fech[i]) out[new Date(t * 1000).toISOString().slice(0, 10)] = arred(fech[i], 4); });
  return out;
}

async function fred(amb, serie, desde = "2023-01-01") {
  const t = await baixar(amb, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${serie}&cosd=${desde}`, { binario: false, tentativas: 3 });
  const out = {};
  for (const l of t.split(/\r?\n/)) {
    const c = l.split(",");
    if (c.length === 2 && c[0].startsWith("20") && c[1] !== "" && isFinite(+c[1])) out[c[0]] = arred(+c[1], 4);
  }
  return out;
}

export async function dolar(amb, desde = "2023-01-01") {
  const erros = [];
  try {
    const ini = `${desde.slice(8, 10)}/${desde.slice(5, 7)}/${desde.slice(0, 4)}`;
    const lista = JSON.parse(await baixar(amb, `https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json&dataInicial=${ini}`, { binario: false }));
    const out = {};
    for (const x of lista) out[dataBr(x.data)] = parseFloat(x.valor);
    if (Object.keys(out).length) return [out, "Banco Central (PTAX)"];
  } catch (e) { erros.push(`BCB: ${e.message}`); }
  try { const o = await yahoo(amb, "BRL=X", "2y"); if (Object.keys(o).length) return [o, "Yahoo Finance (BRL=X)"]; } catch (e) { erros.push(`Yahoo: ${e.message}`); }
  try { const o = await fred(amb, "DEXBZUS", desde); if (Object.keys(o).length) return [o, "FRED (DEXBZUS)"]; } catch (e) { erros.push(`FRED: ${e.message}`); }
  throw new FalhaFonte("dólar: todas as fontes falharam — " + erros.join(" | "));
}

export async function brent(amb, desde = "2023-01-01") {
  const serie = {}, fontes = [], erros = [];
  try {
    const j = JSON.parse(await baixar(amb, "https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='EIA366_PBRENT366')", { binario: false, tempo: 90 }));
    for (const x of j.value) { const d = x.VALDATA.slice(0, 10); if (d >= desde && x.VALVALOR) serie[d] = +x.VALVALOR; }
    fontes.push("Ipeadata/EIA");
  } catch (e) {
    erros.push(`Ipeadata: ${e.message}`);
    try { Object.assign(serie, await fred(amb, "DCOILBRENTEU", desde)); fontes.push("FRED/EIA"); } catch (e2) { erros.push(`FRED: ${e2.message}`); }
  }
  try {
    const rec = await yahoo(amb, "BZ=F", "1mo");
    for (const [d, v] of Object.entries(rec)) if (!(d in serie) || d > maxChave(serie)) serie[d] = v;
    fontes.push("Yahoo (BZ=F)");
  } catch (e) { erros.push(`Yahoo: ${e.message}`); }
  if (!Object.keys(serie).length) throw new FalhaFonte("Brent: todas as fontes falharam — " + erros.join(" | "));
  if (erros.length && amb.log) amb.log("Brent com fonte de reserva: " + erros.join(" | "));
  return [serie, fontes.join(" + ")];
}

// ====================================================================== notícias

const BUSCAS = ["preço gasolina Petrobras", "gasolina reajuste distribuidoras", "desoneração gasolina PIS Cofins",
  "ICMS combustíveis Confaz", "Abicom defasagem gasolina", "etanol anidro preço usinas", "petróleo Brent"];
const ETIQUETAS = [["Petrobras", /PETROBRAS/], ["Impostos", /ICMS|PIS|COFINS|CIDE|DESONERA|TRIBUT|IMPOSTO|CBS/],
  ["Etanol", /ETANOL|ANIDRO|USINA|CANA/], ["Petróleo", /PETROLEO|BRENT|OPEP|ORMUZ|BARRIL/], ["Refinarias", /ACELEN|MATARIPE|REFINARIA|ABICOM|IMPORTA/]];
const campoXml = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`)); return m ? desescapar(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : null; };

export async function buscarNoticias(amb, agoraTs, dias = 10, maximo = 30) {
  const itens = [], vistos = new Set(), erros = [];
  const limite = agoraTs - dias * 86400;
  const res = await Promise.all(BUSCAS.map(q => baixar(amb, "https://news.google.com/rss/search?hl=pt-BR&gl=BR&ceid=BR:pt-419&q=" + encodeURIComponent(`${q} when:${dias}d`), { binario: false, tentativas: 2 }).catch(e => { erros.push(e.message); return null; })));
  for (const xml of res) {
    if (!xml) continue;
    for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      let titulo = desescapar(campoXml(it[1], "title") || "").trim();
      const fonte = (campoXml(it[1], "source") || "").trim();
      if (fonte && titulo.endsWith(" - " + fonte)) titulo = titulo.slice(0, -(fonte.length + 3));
      const chave = semAcento(titulo).replace(/[^\p{L}\p{N}_]+/gu, "").slice(0, 70);
      if (!titulo || vistos.has(chave)) continue;
      const q = Date.parse(campoXml(it[1], "pubDate") || "");
      if (!isFinite(q)) continue;
      const quando = q / 1000;
      if (quando < limite) continue;
      vistos.add(chave);
      const t = semAcento(titulo);
      if (!/GASOLINA|COMBUST|PETROBRAS|PETROLEO|BRENT|ETANOL|ICMS|ABICOM/.test(t)) continue;
      itens.push({ titulo, fonte, link: campoXml(it[1], "link"), quando: Math.trunc(quando), etiquetas: ETIQUETAS.filter(([, p]) => p.test(t)).map(([n]) => n) });
    }
  }
  if (!itens.length && erros.length) throw new FalhaFonte("Google Notícias não respondeu: " + erros[0]);
  itens.sort((a, b) => b.quando - a.quando);
  return itens.slice(0, maximo);
}

// ====================================================================== previsão (igual a coletor/previsao.py)

export const SUAVE = 3, REF = [3, 10], HORIZONTE = 3, LIMIAR = 0.05, ENCOLHE = 50;
const COMPONENTES = ["gasolina_a", "anidro", "federais", "icms"];
const FAIXAS = [[-Infinity, -0.20], [-0.20, -0.10], [-0.10, 0.10], [0.10, 0.20], [0.20, Infinity]];
const NOMES_FAIXA = ["preço bem acima do custo", "preço acima do custo", "equilibrado", "custo acima do preço", "custo bem acima do preço"];
const K = ["sobe", "desce", "igual"];

export function composicoes(sinteses) {
  const o = {};
  for (const [s, v] of Object.entries(sinteses)) if (v.composicao) o[s] = Object.fromEntries(COMPONENTES.map(k => [k, v.composicao[k]]));
  return o;
}
const classe = v => v > LIMIAR ? "sobe" : v < -LIMIAR ? "desce" : "igual";
function faixaDe(g) { for (let i = 0; i < FAIXAS.length; i++) if (FAIXAS[i][0] < g && g <= FAIXAS[i][1]) return i; return 2; }

function conta(semanas, comp, precos, i) {
  const s = semanas[i];
  if (!(s in precos) || i < REF[1] + 1) return null;
  const atuais = semanas.slice(i - SUAVE + 1, i + 1);
  const ref = semanas.slice(i - REF[1], i - REF[0] + 1).filter(j => j in precos);
  if (ref.length < (REF[1] - REF[0]) - 2) return null;
  const mud = {};
  for (const c of COMPONENTES) mud[c] = media(atuais.map(j => comp[j][c])) - media(ref.map(j => comp[j][c]));
  const ja = precos[s] - media(ref.map(j => precos[j]));
  return { custos: mud, ja_repassado: ja, falta: COMPONENTES.reduce((t, c) => t + mud[c], 0) - ja };
}

export function tabelaDeChances(series, comp) {
  const semanas = chavesOrd(comp);
  const cont = FAIXAS.map(() => ({ sobe: 0, desce: 0, igual: 0, var: [] }));
  const base = { sobe: 0, desce: 0, igual: 0 };
  for (const precos of Object.values(series)) {
    for (let i = 0; i < semanas.length - HORIZONTE; i++) {
      const c = conta(semanas, comp, precos, i), fut = semanas[i + HORIZONTE];
      if (!c || !(fut in precos)) continue;
      const real = precos[fut] - precos[semanas[i]];
      const f = cont[faixaDe(c.falta)];
      f[classe(real)]++; f.var.push(real); base[classe(real)]++;
    }
  }
  const tb = (base.sobe + base.desce + base.igual) || 1;
  return {
    faixas: cont.map((f, i) => {
      const n = f.sobe + f.desce + f.igual;
      return {
        faixa: i, nome: NOMES_FAIXA[i], de: isFinite(FAIXAS[i][0]) ? FAIXAS[i][0] : null, ate: isFinite(FAIXAS[i][1]) ? FAIXAS[i][1] : null,
        casos: n, sobe: n ? arred(f.sobe / n) : null, desce: n ? arred(f.desce / n) : null, igual: n ? arred(f.igual / n) : null,
        mediana: f.var.length ? arred(mediana(f.var)) : null,
      };
    }),
    casos: tb, normal: Object.fromEntries(K.map(k => [k, arred(base[k] / tb)])),
  };
}

function chancesPara(g, tabela) {
  const f = tabela.faixas[faixaDe(g)], nor = tabela.normal, n = f.casos || 0, w = n / (n + ENCOLHE);
  const out = Object.fromEntries(K.map(k => [k, arred(w * (f[k] || 0) + (1 - w) * nor[k])]));
  return Object.assign(out, { faixa: f.faixa, casos: n, mediana: f.mediana });
}

function veredito(ch, normal) {
  const s = ch.sobe, d = ch.desce;
  if (s >= 0.35 && s >= 1.4 * normal.sobe && s > d + 0.1) return "sobe";
  if (d >= 0.35 && d >= 1.3 * normal.desce && d > s + 0.1) return "desce";
  if ((ch.igual || 0) >= 0.5) return "igual";
  return "incerto";
}

export function analisar(precos, comp, tabela, eventosProximos = []) {
  if (!precos || !Object.keys(precos).length) return null;
  const ult = maxChave(precos);
  const compAj = { ...comp };
  let semCusto = null;
  if (!(ult in compAj) && Object.keys(comp).length) { semCusto = maxChave(comp); compAj[ult] = comp[semCusto]; }
  const semanas = chavesOrd(compAj);
  const idx = semanas.indexOf(ult);
  if (idx < 0) return null;
  const c = conta(semanas, compAj, precos, idx);
  if (!c) return null;
  const ch = chancesPara(c.falta, tabela);
  let v = veredito(ch, tabela.normal);
  const somaEv = arred(eventosProximos.reduce((t, e) => t + e.efeito, 0));
  if (somaEv >= LIMIAR) v = "sobe"; else if (somaEv <= -LIMIAR) v = "desce";
  const ds = chavesOrd(precos), ant = ds.length > 1 ? ds[ds.length - 2] : null;
  return {
    semana: ult, semana_custo: semCusto || ult, preco: precos[ult],
    var_semana: ant ? arred(precos[ult] - precos[ant]) : null,
    custos_mudaram: Object.fromEntries(Object.entries(c.custos).map(([k, x]) => [k, arred(x)])),
    ja_repassado: arred(c.ja_repassado), falta_repassar: arred(c.falta),
    chances: ch, eventos: [...eventosProximos], soma_eventos: somaEv, veredito: v,
  };
}

function avaliarRegistro(registro, seriesPorLugar) {
  let casos = 0, acertos = 0;
  for (const [sem, prevs] of Object.entries(registro)) {
    for (const [lugar, p] of Object.entries(prevs)) {
      const serie = seriesPorLugar[lugar] || {};
      const datas = chavesOrd(serie);
      if (!(sem in serie)) continue;
      const i = datas.indexOf(sem);
      if (i + HORIZONTE >= datas.length) continue;
      const real = classe(serie[datas[i + HORIZONTE]] - serie[sem]);
      const mp = K.reduce((m, k) => ((p[k] || 0) > (p[m] || 0) ? k : m), "sobe");
      casos++; acertos += mp === real ? 1 : 0;
    }
  }
  const ks = Object.keys(registro).sort();
  return { casos, acerto: casos ? arred(acertos / casos) : null, desde: ks.length ? ks[0] : null };
}

export function avaliarHistorico(series, comp, semanasTeste = 52) {
  const semanas = chavesOrd(comp);
  const casos = [];
  for (const precos of Object.values(series))
    for (let i = 0; i < semanas.length - HORIZONTE; i++) {
      const c = conta(semanas, comp, precos, i), fut = semanas[i + HORIZONTE];
      if (c && fut in precos) casos.push([semanas[i], faixaDe(c.falta), classe(precos[fut] - precos[semanas[i]])]);
    }
  const teste = semanas.slice(0, -HORIZONTE).slice(-semanasTeste);
  const r = { brier: 0, brier_normal: 0, n: 0, aviso_sobe: 0, aviso_sobe_ok: 0, aviso_desce: 0, aviso_desce_ok: 0, real_sobe: 0, real_desce: 0 };
  for (const t of teste) {
    const lim = semanas[semanas.indexOf(t) - HORIZONTE];
    if (lim === undefined) continue;
    const cnt = FAIXAS.map(() => ({ sobe: 0, desce: 0, igual: 0 })), base = { sobe: 0, desce: 0, igual: 0 };
    for (const [s, f, real] of casos) if (s <= lim) { cnt[f][real]++; base[real]++; }
    const tb = base.sobe + base.desce + base.igual;
    if (!tb) continue;
    const tabela = {
      normal: Object.fromEntries(K.map(k => [k, base[k] / tb])),
      faixas: cnt.map((c, i) => { const n = c.sobe + c.desce + c.igual; return { faixa: i, casos: n, mediana: null, ...Object.fromEntries(K.map(k => [k, n ? c[k] / n : null])) }; }),
    };
    for (const [s, f, real] of casos) {
      if (s !== t) continue;
      const a = FAIXAS[f][0], b = FAIXAS[f][1];
      const g = isFinite(a + b) ? (a + b) / 2 : (a === -Infinity ? -1 : 1);
      const ch = chancesPara(g, tabela), nor = tabela.normal;
      r.n++;
      r.brier += K.reduce((t2, k) => t2 + (ch[k] - (real === k ? 1 : 0)) ** 2, 0);
      r.brier_normal += K.reduce((t2, k) => t2 + (nor[k] - (real === k ? 1 : 0)) ** 2, 0);
      const v = veredito(ch, nor);
      r.real_sobe += real === "sobe"; r.real_desce += real === "desce";
      if (v === "sobe") { r.aviso_sobe++; r.aviso_sobe_ok += real === "sobe"; }
      if (v === "desce") { r.aviso_desce++; r.aviso_desce_ok += real === "desce"; }
    }
  }
  const n = r.n;
  if (!n) return null;
  return {
    desde: teste[0], casos: n, melhora_sobre_media: arred(1 - r.brier / r.brier_normal),
    avisos_alta: r.aviso_sobe, avisos_alta_certos: r.aviso_sobe ? arred(r.aviso_sobe_ok / r.aviso_sobe) : null,
    avisos_queda: r.aviso_desce, avisos_queda_certos: r.aviso_desce ? arred(r.aviso_desce_ok / r.aviso_desce) : null,
    alta_normal: arred(r.real_sobe / n), queda_normal: arred(r.real_desce / n),
  };
}

// ====================================================================== atualização (igual a coletor/atualizar.py)

const REGIAO = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte", AL: "Nordeste", BA: "Nordeste",
  CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste", DF: "Centro-Oeste",
  GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste", ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste", PR: "Sul", RS: "Sul", SC: "Sul",
};
const NOME_UF = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
export const NOMES_FONTES = {
  anp_semanal: "ANP · preços nos postos (semanal)", anp_sintese: "ANP · Síntese Semanal (custos, gasolina A, PPI, anidro)",
  dolar: "Dólar", brent: "Petróleo Brent", noticias: "Google Notícias",
};
const PRAZO = { anp_semanal: 13, anp_sintese: 15, dolar: 5, brent: 6, noticias: 3 };

/** Os nomes da base são os mesmos dos arquivos dados/*.json do PC. */
export const ARQS = {
  ufs: "precos_ufs.json", brasil: "precos_brasil.json", mun: "precos_municipios.json", detalhe: "detalhe_ultima_semana.json",
  sinteses: "sinteses.json", lidas: "sinteses_lidas.json", mercado: "mercado.json", noticias: "noticias.json",
  fontes: "fontes.json", registro: "previsoes_registradas.json", nomes: "nomes_municipios.json", controle: "controle.json",
};

async function etapa(base, nome, funcao, amb) {
  const st = base.fontes[nome] = base.fontes[nome] || {};
  st.ultima_tentativa = agoraSP().iso;
  try {
    const info = (await funcao()) || {};
    Object.assign(st, { ok: true, erro: null, falhas_seguidas: 0, ultimo_sucesso: st.ultima_tentativa }, info);
    amb.log && amb.log(`OK   ${nome} ${info.msg || ""}`);
  } catch (e) {
    Object.assign(st, { ok: false, erro: String(e.message || e).slice(0, 400), falhas_seguidas: (st.falhas_seguidas || 0) + 1 });
    amb.log && amb.log(`ERRO ${nome} ${e.message || e}`);
  }
}

async function etSemanal(base, amb) {
  const resumos = await ultimosResumos(amb);
  const ultima = maxChave(base.brasil) || "";
  let novos = resumos.filter(([s]) => s > ultima);
  if (!novos.length) novos = resumos.slice(0, 1);
  for (const [, u] of novos.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    amb.progresso && amb.progresso("Baixando os preços da ANP…");
    const r = await lerResumo(await baixar(amb, u));
    const s = r.semana;
    for (const [uf, v] of Object.entries(r.ufs)) (base.ufs[uf] = base.ufs[uf] || {})[s] = v.p;
    for (const [k, v] of Object.entries(r.municipios)) (base.mun[k] = base.mun[k] || {})[s] = v.p;
    base.brasil[s] = r.brasil.p;
    if (s >= (base.detalhe.semana || "")) base.detalhe = { semana: s, inicio: r.inicio, brasil: r.brasil, ufs: r.ufs, municipios: r.municipios };
  }
  const s = maxChave(base.brasil);
  return { data_dado: s, msg: `semana até ${s}` };
}

async function etSintese(base, amb) {
  const lista = await sintesesDisponiveis(amb, 2024);
  let feitas = 0;
  const erros = [];
  // no celular só interessam as edições novas: as antigas já vieram com o app
  for (const [ano, ed, u] of [...lista].sort(compTupla).slice(-160)) {
    const lida = base.lidas[u];
    if (lida && (lida.ok || lida.ignorar)) continue;
    try {
      amb.progresso && amb.progresso(`Lendo a Síntese da ANP (edição ${ed}/${ano})…`);
      const s = lerSintese(await amb.pdfTexto(await baixar(amb, u, { tempo: 90 })));
      base.sinteses[s.semana] = s;
      base.lidas[u] = { ok: true, semana: s.semana };
      feitas++;
    } catch (e) {          // qualquer falha nesta edição (download, PDF ou formato) fica anotada
      const tent = ((lida || {}).tentativas || 0) + 1;
      const antiga = ano < 2024 || (ano === 2024 && ed < 20);
      base.lidas[u] = { ok: false, erro: String(e.message).slice(0, 200), tentativas: tent, ignorar: antiga || tent >= 6 };
      if (!antiga) erros.push(`${ano}/${ed}: ${e.message}`);
    }
  }
  if (!Object.keys(base.sinteses).length) throw new FalhaFonte("nenhuma síntese lida: " + erros.slice(0, 2).join("; "));
  const s = maxChave(base.sinteses);
  const maisNova = [...lista].sort(compTupla).pop();
  const st = base.lidas[maisNova[2]] || {};
  if (!st.ok) throw new FalhaFonte(`a síntese mais nova (${maisNova[1]}/${maisNova[0]}) não pôde ser lida: ${st.erro || "?"} — usando a de ${s}`);
  return { data_dado: s, msg: `${feitas} novas; mais recente: semana até ${s}` };
}

async function etDolar(base, amb) {
  const [serie, fonte] = await dolar(amb, "2023-01-01");
  Object.assign(base.mercado.dolar = base.mercado.dolar || {}, serie);
  base.mercado.fonte_dolar = fonte;
  const d = maxChave(serie);
  if (!(serie[d] > 2 && serie[d] < 15)) throw new FalhaFonte(`dólar estranho: ${serie[d]}`);
  return { data_dado: d, msg: `${fonte}: R$ ${serie[d].toFixed(4)} em ${d}`, fonte };
}

async function etBrent(base, amb) {
  let [serie, fonte] = await brent(amb, "2023-01-01");
  serie = Object.fromEntries(Object.entries(serie).filter(([, v]) => v > 10 && v < 300));
  Object.assign(base.mercado.brent = base.mercado.brent || {}, serie);
  base.mercado.fonte_brent = fonte;
  const d = maxChave(serie);
  return { data_dado: d, msg: `${fonte}: US$ ${serie[d].toFixed(2)} em ${d}`, fonte };
}

async function etNoticias(base, amb) {
  const a = agoraSP();
  const itens = await buscarNoticias(amb, a.ts);
  base.noticias = { itens, em: a.iso };
  return { data_dado: a.dia, msg: `${itens.length} manchetes` };
}

const valorEm = (serie, data) => { let m = null; for (const d in serie) if (d <= data && (m === null || d > m)) m = d; return m === null ? null : serie[m]; };
function variacao(serie, dias) {
  if (!serie || !Object.keys(serie).length) return null;
  const d = maxChave(serie), ref = valorEm(serie, somaDias(d, -dias));
  return ref ? arred(serie[d] / ref - 1, 4) : null;
}

function pressaoInternacional(base) {
  const sint = base.sinteses;
  if (!Object.keys(sint).length) return null;
  const ppiAll = {}, realAll = {};
  for (const s of Object.values(sint)) {
    for (const [k, v] of Object.entries(s.ppi || {})) if (v) ppiAll[k] = v;
    for (const [k, v] of Object.entries(s.realizacao || {})) if (v) realAll[k] = v;
  }
  if (!Object.keys(ppiAll).length || !Object.keys(realAll).length) return null;
  const dPpi = maxChave(ppiAll), ppi = ppiAll[dPpi], dReal = maxChave(realAll), real = realAll[dReal];
  const br = base.mercado.brent || {}, us = base.mercado.dolar || {};
  let ppiEst = ppi, dMer = dPpi;
  if (Object.keys(br).length && Object.keys(us).length) {
    const b0 = valorEm(br, dPpi), u0 = valorEm(us, dPpi);
    dMer = [maxChave(br), maxChave(us)].sort()[0];
    const b1 = valorEm(br, dMer), u1 = valorEm(us, dMer);
    if (b0 && u0 && b1 && u1 && dMer > dPpi) ppiEst = ppi * (b1 * u1) / (b0 * u0);
  }
  return {
    realizacao: real, data_realizacao: dReal, ppi, data_ppi: dPpi, ppi_estimado: arred(ppiEst), data_estimativa: dMer,
    defasagem: arred(real / ppiEst - 1, 4), defasagem_ppi_anp: arred(real / ppi - 1, 4), variacao_ppi_desde_sintese: arred(ppiEst - ppi),
  };
}

const brData = iso => { iso = String(iso).slice(0, 10); return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; };

function montarEventos(cfg, noticias, hoje) {
  const saida = [], avisos = [];
  for (const e0 of cfg.eventos || []) {
    const e = { ...e0 };
    const fim = e.fim || null;
    e.dias = diasDe(e.data) - diasDe(hoje);
    if (fim && e.data <= hoje && hoje <= fim) e.andamento = true;
    if ((fim || e.data) < hoje) {
      if (e.status === "confirmado") e.status = "aconteceu";
      else if (e.status === "depende") {
        e.verificar = true;
        avisos.push(`O evento "${e.titulo}" era para ${brData(e.data)}. Confira se aconteceu ou foi adiado e atualize o calendário.`);
      }
    }
    if (e.busca) {
      const chaves = e.busca.map(semAcento);
      const r = e.revisado_em || "2000-01-01";
      const revisto = Date.parse(r + "T00:00:00-03:00") / 1000;
      e.noticias = noticias.filter(n => n.quando > revisto && chaves.every(c => semAcento(n.titulo).includes(c))).slice(0, 3);
      if (e.noticias.length && e.status === "depende" && e.dias >= -7) e.noticia_alerta = true;
    }
    saida.push(e);
  }
  saida.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return [saida, avisos];
}

const ANUNCIO = /(PETROBRAS|ACELEN|MATARIPE|REFINARIA|REAM|DISTRIBUIDORAS)/;
const SOBE = /\b(AUMENTA|ELEVA|SOBE|SUBIR|REAJUSTA|REAJUSTE|ALTA|ENCARECE|MAIS CAR)/;
const DESCE = /\b(REDUZ|REDUCAO|CORTA|CORTE|BAIXA|CAI|QUEDA|RECUA|DIMINUI|MAIS BARAT)/;
const DUVIDA = /\b(PODE|PODERIA|DEVE|AVALIA|ESTUDA|NEGA|DESCARTA|SE |VAI\?|\?)/;

function sinaisNoticias(noticias) {
  const out = [];
  for (const n of noticias) {
    const t = semAcento(n.titulo);
    if (!t.includes("GASOLINA") || !ANUNCIO.test(t)) continue;
    const s = SOBE.test(t), d = DESCE.test(t);
    if (s === d) continue;
    out.push({ titulo: n.titulo, link: n.link, fonte: n.fonte, quando: n.quando, direcao: s ? "sobe" : "desce", especulacao: DUVIDA.test(t + " ") });
  }
  return out.slice(0, 6);
}

function ultimo(serie, unidade) {
  if (!serie || !Object.keys(serie).length) return null;
  const d = maxChave(serie);
  return { valor: serie[d], data: d, unidade, var7: variacao(serie, 7), var30: variacao(serie, 30) };
}

/** Monta painel.json, historico.json e municipios.json (os arquivos que a tela lê). */
export function gerarSaidas(base, cfg, opcoes = {}) {
  const comp = composicoes(base.sinteses);
  if (!Object.keys(comp).length || !Object.keys(base.ufs).length) throw new Error("Sem dados suficientes para gerar a previsão.");
  const tabela = tabelaDeChances(base.ufs, comp);
  const teste = avaliarHistorico(base.ufs, comp, 52);
  const press = pressaoInternacional(base);
  const agora = agoraSP(opcoes.agora);
  const hoje = agora.dia;
  const noticias = (base.noticias || {}).itens || [];
  const [eventos, avisos] = montarEventos(cfg, noticias, hoje);
  const proximos = eventos.filter(e => e.status === "confirmado" && e.efeito && e.dias >= 0 && e.dias <= 7 * HORIZONTE).map(e => ({ titulo: e.titulo, data: e.data, efeito: e.efeito }));
  const cenarios = eventos.filter(e => e.status === "depende" && e.efeito && e.dias >= 0 && e.dias <= 60).map(e => ({ titulo: e.titulo, data: e.data, efeito: e.efeito }));

  const det = base.detalhe || {};
  const ufs = {};
  for (const uf of chavesOrd(base.ufs)) {
    const a = analisar(base.ufs[uf], comp, tabela, proximos);
    if (!a) continue;
    Object.assign(a, { nome: NOME_UF[uf], regiao: REGIAO[uf], refinaria_privada: (cfg.refinaria_privada || {})[uf] ?? null, faixa_precos: (det.ufs || {})[uf] ?? null });
    ufs[uf] = a;
  }
  const br = analisar(base.brasil, comp, tabela, proximos);
  Object.assign(br, { nome: "Brasil", faixa_precos: det.brasil ?? null });

  const semana = br.semana;
  if (!(semana in base.registro)) {
    base.registro[semana] = Object.fromEntries(Object.entries(ufs).map(([uf, a]) => [uf, Object.fromEntries(K.map(k => [k, a.chances[k]]))]));
    base.registro[semana].BR = Object.fromEntries(K.map(k => [k, br.chances[k]]));
  }
  const aoVivo = avaliarRegistro(base.registro, { ...base.ufs, BR: base.brasil });

  const fontes = [];
  for (const [fid, nome] of Object.entries(NOMES_FONTES)) {
    const st = base.fontes[fid] || {};
    let atrasada = false;
    if (st.data_dado) atrasada = diasDe(hoje) - diasDe(String(st.data_dado).slice(0, 10)) > PRAZO[fid];
    fontes.push({ id: fid, nome, ok: st.ok || false, erro: st.erro ?? null, ultimo_sucesso: st.ultimo_sucesso ?? null, data_dado: st.data_dado ?? null, fonte: st.fonte ?? null, atrasada, falhas_seguidas: st.falhas_seguidas || 0 });
    if (!st.ok) avisos.push(`${nome}: a última tentativa falhou; o app usa o último dado bom` + (st.data_dado ? ` (de ${brData(st.data_dado)}).` : "."));
    else if (atrasada) avisos.push(`${nome}: sem dado novo desde ${brData(st.data_dado)} (a fonte pode estar atrasada).`);
  }
  if (br.semana_custo !== br.semana) avisos.push(`A ANP já publicou os preços da semana, mas os custos (Síntese) ainda não: a conta usa os custos da semana até ${brData(br.semana_custo)}.`);

  const serieS = { realizacao: {}, ppi: {}, golfo: {}, anidro: {} }, compl = {};
  for (const sem of chavesOrd(base.sinteses)) {
    const s = base.sinteses[sem];
    for (const k in serieS) for (const [d, v] of Object.entries(s[k] || {})) if (v) serieS[k][d] = v;
    compl[sem] = s.composicao;
  }
  const ultComp = maxChave(compl);
  const painel = {
    versao: 2, endereco_publico: opcoes.endereco_publico ?? null, gerado_em: agora.iso,
    semana, semana_inicio: det.inicio ?? null, brasil: br, ufs,
    composicao: compl[ultComp], composicao_semana: ultComp, pressao: press,
    mercado: {
      brent: ultimo(base.mercado.brent || {}, "US$/barril"), dolar: ultimo(base.mercado.dolar || {}, "R$"),
      anidro: ultimo(serieS.anidro, "R$/L"), realizacao: ultimo(serieS.realizacao, "R$/L"),
    },
    eventos, cenarios, anuncios: sinaisNoticias(noticias), noticias: noticias.slice(0, 20), fontes, avisos,
    modelo: { tabela, teste_ultimo_ano: teste, ao_vivo: aoVivo, horizonte: HORIZONTE, limiar: LIMIAR, suave: SUAVE, ref: REF },
  };

  const semanas = chavesOrd(base.brasil);
  const arr = (serie, ds) => ds.map(d => serie[d] ?? null);
  const sv = o => ({ d: chavesOrd(o), v: chavesOrd(o).map(d => o[d]) });
  const cs = chavesOrd(compl);
  const historico = {
    semanas, brasil: arr(base.brasil, semanas),
    ufs: Object.fromEntries(chavesOrd(base.ufs).map(uf => [uf, arr(base.ufs[uf], semanas)])),
    sintese: Object.fromEntries(Object.entries(serieS).map(([k, v]) => [k, sv(v)])),
    composicao: { semanas: cs, ...Object.fromEntries(["gasolina_a", "anidro", "federais", "icms", "margens", "total"].map(c => [c, cs.map(s => compl[s][c])])) },
    mercado: { brent: sv(base.mercado.brent || {}), dolar: sv(base.mercado.dolar || {}) },
  };

  const todas = new Set();
  for (const p of Object.values(base.mun)) for (const s in p) todas.add(s);
  const semM = [...todas].sort().slice(-52);
  const lista = [];
  const ultSem = det.semana;
  for (const [chave, precos] of Object.entries(base.mun)) {
    if (!(ultSem in precos)) continue;
    const [uf, nome] = [chave.slice(0, chave.indexOf("/")), chave.slice(chave.indexOf("/") + 1)];
    const a = analisar(precos, comp, tabela, proximos);
    const item = { id: chave, uf, nome: base.nomes[chave] || nome.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, p, l) => p + l.toUpperCase()), p: precos[ultSem], faixa_precos: (det.municipios || {})[chave] ?? null, serie: arr(precos, semM) };
    if (a) item.a = a;
    lista.push(item);
  }
  lista.sort((x, y) => (x.uf < y.uf ? -1 : x.uf > y.uf ? 1 : semAcento(x.nome) < semAcento(y.nome) ? -1 : semAcento(x.nome) > semAcento(y.nome) ? 1 : 0));
  return { painel, historico, municipios: { semanas: semM, lista } };
}

/** Atualização completa. Muda a base (como o Python) e devolve as saídas + quais fontes falharam. */
export async function atualizar(base, cfg, amb, opcoes = {}) {
  for (const k of Object.keys(ARQS)) base[k] = base[k] || {};
  const passos = [
    ["anp_semanal", () => etSemanal(base, amb), "Buscando os preços nos postos (ANP)…"],
    ["anp_sintese", () => etSintese(base, amb), "Buscando os custos (Síntese da ANP)…"],
    ["dolar", () => etDolar(base, amb), "Buscando o dólar…"],
    ["brent", () => etBrent(base, amb), "Buscando o petróleo…"],
    ["noticias", () => etNoticias(base, amb), "Buscando as notícias…"],
  ];
  // as cinco fontes são independentes: busca todas ao mesmo tempo (no celular, cai de ~1 min para ~20 s)
  let prontas = 0;
  const avisar = () => amb.progresso && amb.progresso(`Buscando nas fontes… (${prontas} de ${passos.length} prontas)`);
  avisar();
  await Promise.all(passos.map(([nome, f]) => etapa(base, nome, f, { ...amb, progresso: null }).then(() => { prontas++; avisar(); })));
  base.controle.ultima_execucao = agoraSP().iso;
  const saidas = gerarSaidas(base, cfg, opcoes);
  const falhas = Object.entries(base.fontes).filter(([, st]) => !st.ok).map(([k]) => k);
  return { saidas, falhas };
}
