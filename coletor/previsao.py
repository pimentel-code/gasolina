"""O "motor" da previsão — em forma de CHANCE, medida no histórico.

Por que chance e não um valor exato: testado no histórico 2024-2026, nenhum
modelo de valor exato bateu o simples "vai ficar igual". O preço na bomba
anda em degraus (decisões da Petrobras, do governo e dos postos). Mas a
"conta do repasse" abaixo separa bem as situações: quando ela indica que
falta repassar muito, a chance de alta nas semanas seguintes dobra.

A conta, para cada lugar (Brasil, Estado ou cidade):
1. Custo nacional = gasolina A + etanol anidro + impostos (Síntese da ANP),
   média das últimas 3 semanas (o custo da ANP oscila muito semana a semana).
2. Referência = semanas de 3 a 10 atrás: preço médio e custo médio do lugar.
3. Falta repassar = (quanto o custo mudou) − (quanto o preço do lugar já mudou).
4. A chance vem de uma tabela: em todas as semanas e Estados desde 2024, com
   o "falta repassar" na mesma faixa, quantas vezes o preço subiu, caiu ou
   ficou parado nas 3 semanas seguintes. A tabela se recalcula a cada
   atualização, então o app aprende sozinho com as semanas novas.
"""

import math
import statistics

SUAVE = 3            # semanas na média do custo atual
REF = (3, 10)        # semanas de referência (de 3 a 10 semanas atrás)
HORIZONTE = 3        # semanas à frente
LIMIAR = 0.05        # R$/L: menos que isso conta como "ficou igual"
COMPONENTES = ("gasolina_a", "anidro", "federais", "icms")
FAIXAS = [(-math.inf, -0.20), (-0.20, -0.10), (-0.10, 0.10), (0.10, 0.20), (0.20, math.inf)]
NOMES_FAIXA = ["preço bem acima do custo", "preço acima do custo", "equilibrado",
               "custo acima do preço", "custo bem acima do preço"]


def composicoes(sinteses):
    """{semana: {componente: R$/L}} só das sínteses com composição."""
    return {s: {k: v["composicao"][k] for k in COMPONENTES}
            for s, v in sinteses.items() if v.get("composicao")}


def classe(v):
    return "sobe" if v > LIMIAR else "desce" if v < -LIMIAR else "igual"


def faixa_de(g):
    for i, (a, b) in enumerate(FAIXAS):
        if a < g <= b:
            return i
    return 2


def conta(semanas, comp, precos, i):
    """A conta do repasse na semana semanas[i]. None se faltar dado."""
    s = semanas[i]
    if s not in precos or i < REF[1] + 1:
        return None
    atuais = semanas[i - SUAVE + 1:i + 1]
    ref = [j for j in semanas[i - REF[1]:i - REF[0] + 1] if j in precos]
    if len(ref) < (REF[1] - REF[0]) - 2:
        return None
    mud = {c: statistics.fmean(comp[j][c] for j in atuais) - statistics.fmean(comp[j][c] for j in ref)
           for c in COMPONENTES}
    ja = precos[s] - statistics.fmean(precos[j] for j in ref)
    return {"custos": mud, "ja_repassado": ja, "falta": sum(mud.values()) - ja}


def tabela_de_chances(series, comp, desde=None):
    """Para cada faixa do 'falta repassar': frequência de alta/queda/igual."""
    semanas = sorted(comp)
    cont = [{"sobe": 0, "desce": 0, "igual": 0, "var": []} for _ in FAIXAS]
    base = {"sobe": 0, "desce": 0, "igual": 0}
    for precos in series.values():
        for i in range(len(semanas) - HORIZONTE):
            if desde and semanas[i] < desde:
                continue
            c = conta(semanas, comp, precos, i)
            fut = semanas[i + HORIZONTE]
            if c is None or fut not in precos:
                continue
            real = precos[fut] - precos[semanas[i]]
            f = cont[faixa_de(c["falta"])]
            f[classe(real)] += 1
            f["var"].append(real)
            base[classe(real)] += 1
    total_base = sum(base.values()) or 1
    saida = []
    for i, f in enumerate(cont):
        n = f["sobe"] + f["desce"] + f["igual"]
        saida.append({
            "faixa": i, "nome": NOMES_FAIXA[i],
            "de": None if FAIXAS[i][0] == -math.inf else FAIXAS[i][0],
            "ate": None if FAIXAS[i][1] == math.inf else FAIXAS[i][1],
            "casos": n,
            "sobe": round(f["sobe"] / n, 3) if n else None,
            "desce": round(f["desce"] / n, 3) if n else None,
            "igual": round(f["igual"] / n, 3) if n else None,
            "mediana": round(statistics.median(f["var"]), 3) if f["var"] else None,
        })
    return {"faixas": saida, "casos": total_base,
            "normal": {k: round(v / total_base, 3) for k, v in base.items()}}


ENCOLHE = 50   # quanto puxar a chance para o "normal" quando a faixa tem poucos casos


def chances_para(g, tabela):
    """Chance da faixa, puxada para o normal conforme a quantidade de casos
    (testado: sem isso o app fica confiante demais)."""
    f = tabela["faixas"][faixa_de(g)]
    nor = tabela["normal"]
    n = f["casos"] or 0
    w = n / (n + ENCOLHE)
    out = {k: round(w * (f[k] or 0) + (1 - w) * nor[k], 3) for k in ("sobe", "desce", "igual")}
    out.update(faixa=f["faixa"], casos=n, mediana=f["mediana"])
    return out


def veredito(ch, normal):
    """Frase curta a partir das chances (comparadas com o normal)."""
    s, d = ch["sobe"], ch["desce"]
    if s >= 0.35 and s >= 1.4 * normal["sobe"] and s > d + 0.1:
        return "sobe"
    if d >= 0.35 and d >= 1.3 * normal["desce"] and d > s + 0.1:
        return "desce"
    if ch.get("igual", 0) >= 0.5:
        return "igual"
    return "incerto"


def analisar(precos, comp, tabela, eventos_proximos=()):
    """Previsão para um lugar, na semana mais recente que houver."""
    if not precos:
        return None
    ult = max(precos)
    comp_aj = dict(comp)
    sem_custo = None
    if ult not in comp_aj and comp:
        sem_custo = max(comp)
        comp_aj[ult] = comp[sem_custo]   # síntese da semana ainda não saiu
    semanas = sorted(comp_aj)
    if ult not in semanas:
        return None
    c = conta(semanas, comp_aj, precos, semanas.index(ult))
    if c is None:
        return None
    ch = chances_para(c["falta"], tabela)
    v = veredito(ch, tabela["normal"])
    soma_eventos = round(sum(e["efeito"] for e in eventos_proximos), 3)
    if soma_eventos >= LIMIAR:
        v = "sobe"
    elif soma_eventos <= -LIMIAR:
        v = "desce"
    anterior = sorted(precos)[-2] if len(precos) > 1 else None
    return {
        "semana": ult,
        "semana_custo": sem_custo or ult,
        "preco": precos[ult],
        "var_semana": round(precos[ult] - precos[anterior], 3) if anterior else None,
        "custos_mudaram": {k: round(x, 3) for k, x in c["custos"].items()},
        "ja_repassado": round(c["ja_repassado"], 3),
        "falta_repassar": round(c["falta"], 3),
        "chances": ch,
        "eventos": list(eventos_proximos),
        "soma_eventos": soma_eventos,
        "veredito": v,
    }


def avaliar_registro(registro, series_por_lugar):
    """Acerto das previsões feitas 'ao vivo' (gravadas na semana em que saíram)."""
    casos = acertos = 0
    for sem, prevs in registro.items():
        for lugar, p in prevs.items():
            serie = series_por_lugar.get(lugar) or {}
            datas = sorted(serie)
            if sem not in serie:
                continue
            i = datas.index(sem)
            if i + HORIZONTE >= len(datas):
                continue
            real = classe(serie[datas[i + HORIZONTE]] - serie[sem])
            mais_provavel = max(("sobe", "desce", "igual"), key=lambda k: p.get(k) or 0)
            casos += 1
            acertos += mais_provavel == real
    return {"casos": casos, "acerto": round(acertos / casos, 3) if casos else None,
            "desde": min(registro) if registro else None}


def avaliar_historico(series, comp, semanas_teste=52):
    """Teste honesto, semana a semana: em cada semana do último ano, a tabela é
    montada só com o que já se sabia naquela semana, e a chance é comparada
    com o que aconteceu depois."""
    semanas = sorted(comp)
    casos = []
    for precos in series.values():
        for i in range(len(semanas) - HORIZONTE):
            c = conta(semanas, comp, precos, i)
            fut = semanas[i + HORIZONTE]
            if c and fut in precos:
                casos.append((semanas[i], faixa_de(c["falta"]), classe(precos[fut] - precos[semanas[i]])))
    K = ("sobe", "desce", "igual")
    teste = [s for s in semanas[:-HORIZONTE]][-semanas_teste:]
    r = {"brier": 0.0, "brier_normal": 0.0, "n": 0,
         "aviso_sobe": 0, "aviso_sobe_ok": 0, "aviso_desce": 0, "aviso_desce_ok": 0,
         "real_sobe": 0, "real_desce": 0}
    for t in teste:
        lim = semanas[semanas.index(t) - HORIZONTE]
        cnt = [{k: 0 for k in K} for _ in FAIXAS]
        base = {k: 0 for k in K}
        for s, f, real in casos:
            if s <= lim:
                cnt[f][real] += 1
                base[real] += 1
        tb = sum(base.values())
        if not tb:
            continue
        tabela = {"normal": {k: base[k] / tb for k in K},
                  "faixas": [{"faixa": i, "casos": sum(c.values()), "mediana": None,
                              **{k: (c[k] / sum(c.values()) if sum(c.values()) else None) for k in K}}
                             for i, c in enumerate(cnt)]}
        for s, f, real in casos:
            if s != t:
                continue
            g = (FAIXAS[f][0] + FAIXAS[f][1]) / 2 if math.isfinite(FAIXAS[f][0] + FAIXAS[f][1]) else (
                -1 if FAIXAS[f][0] == -math.inf else 1)
            ch = chances_para(g, tabela)
            nor = tabela["normal"]
            r["n"] += 1
            r["brier"] += sum((ch[k] - (real == k)) ** 2 for k in K)
            r["brier_normal"] += sum((nor[k] - (real == k)) ** 2 for k in K)
            v = veredito(ch, nor)
            r["real_sobe"] += real == "sobe"
            r["real_desce"] += real == "desce"
            if v == "sobe":
                r["aviso_sobe"] += 1
                r["aviso_sobe_ok"] += real == "sobe"
            if v == "desce":
                r["aviso_desce"] += 1
                r["aviso_desce_ok"] += real == "desce"
    n = r["n"]
    if not n:
        return None
    return {
        "desde": teste[0], "casos": n,
        "melhora_sobre_media": round(1 - r["brier"] / r["brier_normal"], 3),
        "avisos_alta": r["aviso_sobe"],
        "avisos_alta_certos": round(r["aviso_sobe_ok"] / r["aviso_sobe"], 3) if r["aviso_sobe"] else None,
        "avisos_queda": r["aviso_desce"],
        "avisos_queda_certos": round(r["aviso_desce_ok"] / r["aviso_desce"], 3) if r["aviso_desce"] else None,
        "alta_normal": round(r["real_sobe"] / n, 3), "queda_normal": round(r["real_desce"] / n, 3),
    }
