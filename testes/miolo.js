// Testa a escolha de versão do miolo.js (o que cada celular recebe sozinho e quando pede APK).
// Uso: node testes/miolo.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = { window: {}, localStorage: { getItem: () => null, setItem() { }, removeItem() { } }, console };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../site/miolo.js"), "utf8"), ctx);
const { escolher } = ctx.window.AtualizarApp;
const rel = (tag, nativo, { teste = false, zip = true, apk = true } = {}) => ({ tag_name: tag, prerelease: teste, draft: false,
  body: `notas\n\n[nativo:${nativo}]`, assets: [zip && { name: "miolo.zip", browser_download_url: "z" + tag }, apk && { name: "Gasolina.apk", browser_download_url: "a" + tag }].filter(Boolean) });
const lista = [rel("v1.6", 5, { teste: true }), rel("v1.5", 3), rel("v1.4", 3), rel("v1.3", 3), rel("v1.2-teste", 2), rel("v1.1", 1, { zip: false })];
const casos = [
  ["estável, APK 3, miolo 3 → recebe miolo 1.5, sem APK", { miolo: 3, nativo: 3, teste: false }, 5, null],
  ["teste ligado → miolo 1.6 exige APK 5: pede APK 1.6 e pega miolo 1.5", { miolo: 3, nativo: 3, teste: true }, 5, 6],
  ["já na 1.5 estável → nada", { miolo: 5, nativo: 3, teste: false }, null, null],
  ["APK antigo (1.1, nativo 1) → pede APK 1.5, não troca miolo", { miolo: 1, nativo: 1, teste: false }, null, 5],
  ["teste ligado, APK 5 → miolo 1.6", { miolo: 5, nativo: 5, teste: true }, 6, null],
];
let falhas = 0;
for (const [nome, op, m, a] of casos) {
  const r = escolher(lista, op);
  const ok = (r.miolo ? r.miolo.codigo : null) === m && (r.apk ? r.apk.codigo : null) === a;
  if (!ok) { falhas++; console.log("FALHA:", nome, "→ miolo", r.miolo && r.miolo.codigo, "apk", r.apk && r.apk.codigo); }
}
console.log(falhas ? `${falhas} falha(s)` : `Tudo certo: ${casos.length} situações de atualização.`);
process.exit(falhas ? 1 : 0);
