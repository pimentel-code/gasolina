// Regra dupla: o preço por posto calculado no celular (coletor-js/postos.mjs) tem de ser
// IDÊNTICO ao do PC (coletor/postos.py). Usa as planilhas que o PC guardou em cache/.
// Uso: node testes/postos.mjs   (antes: python3 -I coletor/postos.py --forcar)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montar, contarCidades, ARQUIVOS, UFS } from "../coletor-js/postos.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ordenado = v => Array.isArray(v) ? v.map(ordenado) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordenado(v[k])])) : v;

const textos = ARQUIVOS.map(a => fs.readFileSync(path.join(RAIZ, "cache", a), "utf8"));
const ref = JSON.parse(fs.readFileSync(path.join(RAIZ, "site/dados/postos/SP.json"), "utf8"));
const t0 = Date.now();
const js = montar(textos, ref.tamanhos, ref.gerado_em);
const ms = Date.now() - t0;
const falhas = [];
for (const uf of UFS) {
  const py = JSON.parse(fs.readFileSync(path.join(RAIZ, "site/dados/postos", uf + ".json"), "utf8"));
  if (JSON.stringify(ordenado(py)) !== JSON.stringify(ordenado(js[uf]))) {
    const cid = Object.keys(py.cidades).find(c => JSON.stringify(ordenado(py.cidades[c])) !== JSON.stringify(ordenado(js[uf].cidades[c])));
    falhas.push(`${uf}: diferente${cid ? " em " + cid : " (cabeçalho)"}`);
  }
}
if (falhas.length) { console.log("FALHAS:\n - " + falhas.slice(0, 10).join("\n - ")); process.exit(1); }
console.log(`Tudo certo: Python × JavaScript idênticos nos 27 Estados (${contarCidades(js)} cidades; JS montou em ${ms} ms).`);
