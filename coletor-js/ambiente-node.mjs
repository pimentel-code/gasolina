// "Ambiente" do coletor JS no PC (Node): baixa com fetch e lê PDF com o pdf.js. Usado nos testes.
import * as pdfjs from "../node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { pdfParaTexto } from "./pdf-texto.mjs";
const AGENTE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36";
async function pedir(url, tempo) {
  const r = await fetch(url, { headers: { "User-Agent": AGENTE, "Accept": "*/*", "Accept-Language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(tempo * 1000) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r;
}
export const ambienteNode = (log = () => { }) => ({
  texto: async (url, { tempo = 60 } = {}) => (await pedir(url, tempo)).text(),
  bytes: async (url, { tempo = 60 } = {}) => new Uint8Array(await (await pedir(url, tempo)).arrayBuffer()),
  pdfTexto: bytes => pdfParaTexto(pdfjs, bytes),
  log, progresso: () => { },
});
