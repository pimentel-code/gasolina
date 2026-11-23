// Compara o coletor do celular (coletor-js, JavaScript) com o do PC (coletor/, Python).
// Uso: node testes/coletor-js.mjs [--rede] [pasta-com-pdfs-da-sintese]
//   sem --rede: só lê arquivos locais (planilha, PDFs) e compara a previsão inteira
//   com --rede: também roda a atualização completa pela internet, a partir de uma
//               base "atrasada" uma semana, e confere se chega ao mesmo resultado
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import * as C from "../coletor-js/coletor.mjs";
import { ambienteNode } from "../coletor-js/ambiente-node.mjs";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ler = f => JSON.parse(fs.readFileSync(path.join(RAIZ, f), "utf8"));
const falhas = [];
const REDE = process.argv.includes("--rede");
const PDFS = process.argv.slice(2).find(a => !a.startsWith("--"));

// compara dois objetos JSON com tolerância numérica; devolve as diferenças
function diferencas(a, b, cam = "", out = [], tol = 0.0015) {
  if (out.length > 15) return out;
  if (typeof a === "number" && typeof b === "number") { if (Math.abs(a - b) > tol) out.push(`${cam}: ${a} ≠ ${b}`); return out; }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") { if (a !== b) out.push(`${cam}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${cam}: tipo diferente`); return out; }
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of ks) {
    if (!(k in a)) { if (b[k] !== null && b[k] !== undefined) out.push(`${cam}.${k}: falta no JS`); continue; }
    if (!(k in b)) { if (a[k] !== null && a[k] !== undefined) out.push(`${cam}.${k}: sobra no JS`); continue; }
    diferencas(a[k], b[k], `${cam}.${k}`, out, tol);
  }
  return out;
}
const base0 = () => Object.fromEntries(Object.entries(C.ARQS).map(([k, f]) => [k, fs.existsSync(path.join(RAIZ, "dados", f)) ? ler("dados/" + f) : {}]));

// 1) planilha semanal da ANP
{
  const xs = fs.readdirSync(path.join(RAIZ, "cache")).filter(f => /^resumo-.*\.xlsx$/.test(f)).sort();
  const det = ler("dados/detalhe_ultima_semana.json");
  const f = xs.find(x => x.includes(det.semana));
  if (!f) console.log("  (sem a planilha da última semana no cache; pulei o teste 1)");
  else {
    const t0 = Date.now();
    const r = await C.lerResumo(new Uint8Array(fs.readFileSync(path.join(RAIZ, "cache", f))));
    const d = diferencas({ semana: r.semana, inicio: r.inicio, brasil: r.brasil, ufs: r.ufs, municipios: r.municipios }, det, "resumo", [], 1e-9);
    if (d.length) falhas.push("planilha ANP: " + d.join("; "));
    else console.log(`✓ planilha da ANP lida igual ao Python (${Object.keys(r.ufs).length} Estados, ${Object.keys(r.municipios).length} cidades, ${Date.now() - t0} ms)`);
  }
}

// 2) PDFs da Síntese
if (PDFS) {
  const lista = JSON.parse(fs.readFileSync(path.join(PDFS, "lista.json")));
  const sint = ler("dados/sinteses.json");
  const amb = ambienteNode();
  let ok = 0;
  for (const x of lista) {
    try {
      const s = C.lerSintese(await amb.pdfTexto(new Uint8Array(fs.readFileSync(x.arquivo))));
      const p = sint[x.semana];
      const d = diferencas(s, p, path.basename(x.arquivo), [], 1e-9);
      if (d.length) falhas.push(`síntese ${path.basename(x.arquivo)}: ${d.join("; ")}`); else ok++;
    } catch (e) { falhas.push(`síntese ${path.basename(x.arquivo)}: ${e.message}`); }
  }
  console.log(`${ok === lista.length ? "✓" : "✗"} Síntese: ${ok} de ${lista.length} PDFs lidos igual ao Python (2024, 2025 e 2026)`);
}

// 3) previsão inteira: mesma base -> mesmas saídas
{
  execFileSync("python3", ["-I", "coletor/atualizar.py", "--so-saidas"], { cwd: RAIZ });
  const py = { painel: ler("site/dados/painel.json"), historico: ler("site/dados/historico.json"), municipios: ler("site/dados/municipios.json") };
  const t0 = Date.now();
  const js = C.gerarSaidas(base0(), ler("eventos.json"), { endereco_publico: py.painel.endereco_publico });
  const ms = Date.now() - t0;
  js.painel.gerado_em = py.painel.gerado_em;
  for (const k of ["painel", "historico", "municipios"]) {
    const d = diferencas(js[k], py[k], k);
    if (d.length) falhas.push(`${k}.json diferente: ` + d.join("; "));
    else console.log(`✓ ${k}.json igual ao do Python`);
  }
  console.log(`  (cálculo da previsão em ${ms} ms)`);
}

// 4) atualização completa pela internet, partindo de uma base com a última semana apagada
if (REDE) {
  const b = base0();
  const ult = Object.keys(b.brasil).sort().pop();
  delete b.brasil[ult];
  for (const s of Object.values(b.ufs)) delete s[ult];
  for (const s of Object.values(b.mun)) delete s[ult];
  b.detalhe = {};
  const ultS = Object.keys(b.sinteses).sort().pop();
  delete b.sinteses[ultS];
  for (const [u, l] of Object.entries(b.lidas)) if (l.semana === ultS) delete b.lidas[u];
  b.mercado = { dolar: {}, brent: {} };
  const t0 = Date.now();
  const r = await C.atualizar(b, ler("eventos.json"), ambienteNode(m => console.log("   ", m)));
  console.log(`  (atualização pela internet em ${((Date.now() - t0) / 1000).toFixed(1)} s; falhas: ${r.falhas.join(", ") || "nenhuma"})`);
  const ref = base0();
  const d = diferencas({ brasil: b.brasil, ufs: b.ufs, sinteses: b.sinteses, detalhe: b.detalhe },
    { brasil: ref.brasil, ufs: ref.ufs, sinteses: ref.sinteses, detalhe: ref.detalhe }, "base", [], 1e-9);
  const dm = diferencas(b.mun, ref.mun, "mun", [], 1e-9);
  if (d.length || dm.length) falhas.push("atualização pela internet: " + [...d, ...dm].join("; "));
  else console.log(`✓ pela internet, recuperou a semana ${ult} e a Síntese de ${ultS} iguais às do Python`);
  if (r.falhas.length) falhas.push("fontes falharam: " + r.falhas.map(f => `${f} (${b.fontes[f].erro})`).join("; "));
  const dol = Object.keys(b.mercado.dolar).sort().pop(), bre = Object.keys(b.mercado.brent).sort().pop();
  console.log(`  dólar até ${dol} (${b.mercado.dolar[dol]}), Brent até ${bre} (${b.mercado.brent[bre]}), ${b.noticias.itens.length} notícias`);
}

if (falhas.length) { console.log("FALHAS:\n - " + falhas.join("\n - ")); process.exit(1); }
console.log("Tudo certo: o coletor do celular dá o mesmo resultado que o do PC.");
