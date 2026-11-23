// PDF -> texto "em colunas", parecido com o pdftotext -layout (páginas separadas por \f).
// Recebe o módulo do pdf.js (navegador ou Node) e os bytes do PDF.
export async function pdfParaTexto(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const tc = await pg.getTextContent();
    const itens = tc.items.filter(i => i.str && i.str.trim()).map(i => ({
      x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || Math.abs(i.height) || 8, s: i.str,
    }));
    // agrupa por linha (mesma altura, com tolerância)
    itens.sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas = [];
    for (const it of itens) {
      const l = linhas.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35));
      if (l) l.itens.push(it); else linhas.push({ y: it.y, itens: [it] });
    }
    linhas.sort((a, b) => b.y - a.y);
    const texto = linhas.map(l => {
      l.itens.sort((a, b) => a.x - b.x);
      let s = "", fim = null;
      for (const it of l.itens) {
        if (fim !== null) {
          const vao = it.x - fim;
          s += vao > it.h * 1.2 ? "     " : vao > it.h * 0.15 ? " " : "";
        }
        s += it.s;
        fim = it.x + it.w;
      }
      return s;
    }).join("\n");
    paginas.push(texto);
    pg.cleanup();
  }
  try { await (doc.destroy ? doc.destroy() : doc.cleanup()); } catch (e) { }
  return paginas.join("\f");
}
