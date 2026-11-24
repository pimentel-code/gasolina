// Preço posto a posto (gasolina, etanol, diesel) — dados abertos da ANP.
// Gêmeo de coletor/postos.py: MESMA conta. Mudou num, mude no outro;
// `node testes/postos.mjs` compara os dois (resultado tem de ser idêntico).

export const PASTA = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/";
export const ARQUIVOS = ["ultimas-4-semanas-gasolina-etanol.csv", "ultimas-4-semanas-diesel-gnv.csv"];
export const URLS = ARQUIVOS.map(a => PASTA + a);
export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB",
  "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const PRODUTOS = { "GASOLINA": "gasolina", "GASOLINA ADITIVADA": "aditivada", "ETANOL": "etanol",
  "DIESEL S10": "diesel_s10", "DIESEL": "diesel", "GNV": "gnv" };

/** CSV com ";" e campos entre aspas (a ANP põe aspas quando o campo tem ";"). */
export function* linhasCSV(texto) {
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ";") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      yield linha; linha = [];
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); yield linha; }
}

const dataIso = s => { s = (s || "").trim(); return s.length === 10 ? `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : ""; };
const limpo = s => (s || "").replace(/;/g, " ").split(/\s+/).filter(Boolean).join(" ");
function preco(s) {
  const t = (s || "").trim().replace(/\./g, "").replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = parseFloat(t);
  return v > 1 && v < 20 ? v : null;            // descarta erro de digitação
}
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** textos = conteúdo das 2 planilhas. Devolve {UF: {...}} para todas as UFs. */
export function montar(textos, tamanhos, geradoEm) {
  const postos = new Map();
  let de = null, ate = null;
  for (const texto of textos) {
    let cab = null;
    for (const lin of linhasCSV(texto.replace(/^﻿/, ""))) {
      if (!cab) { cab = lin; continue; }
      if (lin.length === 1 && lin[0] === "") continue;
      const r = {};
      cab.forEach((k, i) => { r[k] = lin[i]; });
      const prod = PRODUTOS[limpo(r["Produto"]).toUpperCase()];
      const v = preco(r["Valor de Venda"]), d = dataIso(r["Data da Coleta"]);
      const uf = limpo(r["Estado - Sigla"]).toUpperCase(), cid = limpo(r["Municipio"]).toUpperCase();
      if (!prod || v == null || !d || !UFS.includes(uf) || !cid) continue;
      const cnpj = (r["CNPJ da Revenda"] || "").replace(/\D/g, "");
      const chave = JSON.stringify([uf, cid, cnpj || limpo(r["Revenda"])]);
      let p = postos.get(chave);
      if (!p) {
        const num = limpo(r["Numero Rua"]);
        let end = limpo(r["Nome da Rua"]);
        if (num && !["S/N", "SN", "S N", "0"].includes(num.toUpperCase())) end += ", " + num;
        const comp = limpo(r["Complemento"]);
        if (comp) end += " (" + comp + ")";
        p = { nome: limpo(r["Revenda"]), end, bairro: limpo(r["Bairro"]), band: limpo(r["Bandeira"]), p: {} };
        postos.set(chave, p);
      }
      const atual = p.p[prod];
      if (!atual || d > atual[1]) p.p[prod] = [v, d];          // vale a visita mais recente
      if (de === null || d < de) de = d;
      if (ate === null || d > ate) ate = d;
    }
  }
  const saida = {};
  for (const uf of UFS) saida[uf] = { uf, gerado_em: geradoEm, tamanhos, periodo: { de, ate }, cidades: {} };
  const chaves = [...postos.keys()].map(k => [JSON.parse(k), k]);
  chaves.sort((a, b) => cmp(a[0][0], b[0][0]) || cmp(a[0][1], b[0][1]) || cmp(a[0][2], b[0][2]));
  for (const [[uf, cid], k] of chaves) (saida[uf].cidades[cid] ||= []).push(postos.get(k));
  for (const uf of UFS) for (const lista of Object.values(saida[uf].cidades))
    lista.sort((a, b) => cmp(a.nome, b.nome) || cmp(a.end, b.end));   // estável: empate fica na ordem do CNPJ
  return saida;
}

/** Quantas cidades têm postos (para validar a leitura). */
export const contarCidades = s => Object.values(s).reduce((n, x) => n + Object.keys(x.cidades).length, 0);
