/* Gráfico de linhas em SVG, sem bibliotecas: um eixo só, linhas de 2px,
   grade discreta, rótulo no fim da linha, dica ao passar o dedo/mouse e
   a opção "ver tabela" (acessibilidade). */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, pai) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (pai) pai.appendChild(e);
    return e;
  }

  function passoBonito(bruto) {
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    const n = bruto / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function dataCurta(iso, longa) {
    const [a, m, d] = iso.split("-");
    const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return longa ? `${d}/${m}/${a}` : `${meses[+m - 1]}/${a.slice(2)}`;
  }

  /**
   * desenhar(figure, {titulo, subtitulo, unidade, casas, series:[{nome, cor, d:[], v:[]}], marcos:[{data, texto}]})
   */
  function desenhar(fig, op) {
    fig.innerHTML = "";
    const cap = document.createElement("figcaption");
    cap.textContent = op.titulo;
    fig.appendChild(cap);
    if (op.subtitulo) {
      const s = document.createElement("div");
      s.className = "subt";
      s.textContent = op.subtitulo;
      fig.appendChild(s);
    }
    const series = op.series.filter(s => s.d.length);
    if (!series.length) {
      const p = document.createElement("p");
      p.className = "carregando";
      p.textContent = "Sem dados para este período.";
      fig.appendChild(p);
      return;
    }
    if (series.length > 1) {
      const leg = document.createElement("div");
      leg.className = "leg";
      series.forEach(s => {
        const sp = document.createElement("span");
        const i = document.createElement("i");
        i.style.background = s.cor;
        sp.appendChild(i);
        sp.appendChild(document.createTextNode(s.nome));
        leg.appendChild(sp);
      });
      fig.appendChild(leg);
    }

    const casas = op.casas == null ? 2 : op.casas;
    const fmt = v => v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    const larg = Math.max(280, fig.clientWidth || 600);
    const alt = op.altura || (larg < 500 ? 210 : 240);
    const m = { e: 46, d: 64, c: 10, b: 26 };
    const svg = el("svg", { viewBox: `0 0 ${larg} ${alt}`, role: "img", "aria-label": op.titulo }, null);
    fig.appendChild(svg);

    // domínio
    const todasDatas = [...new Set(series.flatMap(s => s.d))].sort();
    const t0 = Date.parse(todasDatas[0]), t1 = Date.parse(todasDatas[todasDatas.length - 1]);
    const vals = series.flatMap(s => s.v).filter(v => v != null);
    let vmin = Math.min(...vals), vmax = Math.max(...vals);
    if (vmin === vmax) { vmin -= 1; vmax += 1; }
    const passo = passoBonito((vmax - vmin) / 4);
    vmin = Math.floor(vmin / passo) * passo;
    vmax = Math.ceil(vmax / passo) * passo;
    const X = t => m.e + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (larg - m.e - m.d);
    const Y = v => alt - m.b - (v - vmin) / (vmax - vmin) * (alt - m.b - m.c);

    // grade e eixo Y
    const g = el("g", { "font-size": 11, fill: "var(--mudo)" }, svg);
    for (let v = vmin; v <= vmax + passo / 2; v += passo) {
      el("line", { x1: m.e, x2: larg - m.d, y1: Y(v), y2: Y(v), stroke: v === vmin ? "var(--eixo)" : "var(--grade)", "stroke-width": 1 }, g);
      const t = el("text", { x: m.e - 6, y: Y(v) + 4, "text-anchor": "end", "font-variant-numeric": "tabular-nums" }, g);
      t.textContent = v.toLocaleString("pt-BR", { maximumFractionDigits: passo < 0.1 ? 2 : passo < 1 ? 1 : 0, minimumFractionDigits: passo < 0.1 ? 2 : passo < 1 ? 1 : 0 });
    }
    // eixo X: até 6 marcas
    const nMarcas = larg < 500 ? 4 : 6;
    for (let i = 0; i < nMarcas; i++) {
      const t = t0 + (t1 - t0) * i / (nMarcas - 1);
      const iso = new Date(t).toISOString().slice(0, 10);
      const tx = el("text", { x: X(t), y: alt - 6, "text-anchor": i === 0 ? "start" : i === nMarcas - 1 ? "end" : "middle" }, g);
      tx.textContent = dataCurta(iso);
    }
    // marcos (eventos)
    (op.marcos || []).forEach(mk => {
      const t = Date.parse(mk.data);
      if (t < t0 || t > t1) return;
      el("line", { x1: X(t), x2: X(t), y1: m.c, y2: alt - m.b, stroke: "var(--eixo)", "stroke-width": 1 }, g);
    });

    // linhas
    const fim = [];
    series.forEach(s => {
      let d = "", aberto = false;
      s.d.forEach((iso, i) => {
        const v = s.v[i];
        if (v == null) { aberto = false; return; }
        d += (aberto ? "L" : "M") + X(Date.parse(iso)).toFixed(1) + "," + Y(v).toFixed(1);
        aberto = true;
      });
      if (s.area) {
        const ult = s.d.length - 1;
        el("path", { d: d + `L${X(Date.parse(s.d[ult]))},${Y(vmin)}L${X(Date.parse(s.d[0]))},${Y(vmin)}Z`, fill: s.cor, opacity: .1 }, svg);
      }
      el("path", { d, fill: "none", stroke: s.cor, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      for (let i = s.v.length - 1; i >= 0; i--) {
        if (s.v[i] != null) { fim.push({ s, x: X(Date.parse(s.d[i])), y: Y(s.v[i]), v: s.v[i] }); break; }
      }
    });
    // rótulos do fim (se colidirem, fica só a legenda + dica)
    fim.sort((a, b) => a.y - b.y);
    const colide = fim.some((f, i) => i && f.y - fim[i - 1].y < 14);
    fim.forEach(f => {
      el("circle", { cx: f.x, cy: f.y, r: 4, fill: f.s.cor, stroke: "var(--sup)", "stroke-width": 2 }, svg);
      if (!colide) {
        const t = el("text", { x: f.x + 8, y: f.y + 4, "font-size": 12, "font-weight": 600, fill: "var(--tinta)" }, svg);
        t.textContent = fmt(f.v);
      }
    });

    // dica com linha-guia
    const guia = el("line", { y1: m.c, y2: alt - m.b, stroke: "var(--tinta-2)", "stroke-width": 1, visibility: "hidden" }, svg);
    const pontos = series.map(s => el("circle", { r: 4.5, fill: s.cor, stroke: "var(--sup)", "stroke-width": 2, visibility: "hidden" }, svg));
    const dica = document.createElement("div");
    dica.className = "dica-graf";
    dica.hidden = true;
    fig.appendChild(dica);
    const alvo = el("rect", { x: m.e, y: 0, width: larg - m.e - m.d, height: alt, fill: "transparent" }, svg);
    function mover(ev) {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (larg / r.width);
      const t = t0 + (px - m.e) / (larg - m.e - m.d) * (t1 - t0);
      let melhor = todasDatas[0], dist = Infinity;
      for (const iso of todasDatas) {
        const dd = Math.abs(Date.parse(iso) - t);
        if (dd < dist) { dist = dd; melhor = iso; }
      }
      const x = X(Date.parse(melhor));
      guia.setAttribute("x1", x); guia.setAttribute("x2", x); guia.setAttribute("visibility", "visible");
      let html = `<b>${dataCurta(melhor, true)}</b>`;
      series.forEach((s, i) => {
        const j = s.d.indexOf(melhor);
        const v = j >= 0 ? s.v[j] : null;
        if (v == null) { pontos[i].setAttribute("visibility", "hidden"); return; }
        pontos[i].setAttribute("cx", x); pontos[i].setAttribute("cy", Y(v)); pontos[i].setAttribute("visibility", "visible");
        html += `<div><i style="background:${s.cor}"></i>${s.nome}: <b style="display:inline">${op.prefixo || ""}${fmt(v)}</b></div>`;
      });
      dica.innerHTML = html;
      dica.hidden = false;
      const fx = (x / larg) * r.width;
      const w = dica.offsetWidth;
      dica.style.left = Math.max(0, Math.min(r.width - w, fx + 12)) + "px";
      dica.style.top = (svg.offsetTop + 6) + "px";
    }
    function sair() {
      guia.setAttribute("visibility", "hidden");
      pontos.forEach(p => p.setAttribute("visibility", "hidden"));
      dica.hidden = true;
    }
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerdown", mover);
    alvo.addEventListener("pointerleave", sair);

    // tabela
    const bt = document.createElement("button");
    bt.type = "button";
    bt.className = "ver-tabela";
    bt.textContent = "Ver tabela";
    bt.setAttribute("aria-expanded", "false");
    fig.appendChild(bt);
    let tab = null;
    bt.addEventListener("click", () => {
      if (tab) { tab.remove(); tab = null; bt.textContent = "Ver tabela"; bt.setAttribute("aria-expanded", "false"); return; }
      tab = document.createElement("div");
      tab.className = "tab";
      const linhas = [...todasDatas].reverse().map(iso =>
        `<tr><td>${dataCurta(iso, true)}</td>${series.map(s => { const j = s.d.indexOf(iso); return `<td class="num">${j >= 0 ? fmt(s.v[j]) : "—"}</td>`; }).join("")}</tr>`).join("");
      tab.innerHTML = `<table><thead><tr><th>Data</th>${series.map(s => `<th class="num">${s.nome}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table>`;
      fig.appendChild(tab);
      bt.textContent = "Esconder tabela";
      bt.setAttribute("aria-expanded", "true");
    });
  }

  window.Graficos = { desenhar, dataCurta };
})();
