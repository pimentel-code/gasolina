#!/usr/bin/env python3
"""Atualiza os dados do app Gasolina.

    python3 coletor/atualizar.py              # atualização normal (rápida)
    python3 coletor/atualizar.py --reconstruir  # baixa todo o histórico de novo

Cada fonte é independente: se uma falhar, as outras seguem e o app mostra o
último dado bom daquela fonte, com o aviso de quando ela falhou."""

import datetime as dt
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import anp                                   # noqa: E402
import mercado                               # noqa: E402
import noticias as mod_noticias              # noqa: E402
import previsao                              # noqa: E402
from util import (CACHE, DADOS, RAIZ, SAIDA, FalhaFonte, agora, baixar,  # noqa: E402
                  baixar_para, gravar_json, hoje, ler_json, log, sem_acento)

REGIAO = {"AC": "Norte", "AP": "Norte", "AM": "Norte", "PA": "Norte", "RO": "Norte",
          "RR": "Norte", "TO": "Norte", "AL": "Nordeste", "BA": "Nordeste",
          "CE": "Nordeste", "MA": "Nordeste", "PB": "Nordeste", "PE": "Nordeste",
          "PI": "Nordeste", "RN": "Nordeste", "SE": "Nordeste", "DF": "Centro-Oeste",
          "GO": "Centro-Oeste", "MT": "Centro-Oeste", "MS": "Centro-Oeste",
          "ES": "Sudeste", "MG": "Sudeste", "RJ": "Sudeste", "SP": "Sudeste",
          "PR": "Sul", "RS": "Sul", "SC": "Sul"}
NOME_UF = {v: k for k, v in anp.UFS.items()}
NOME_UF_BONITO = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia",
    "CE": "Ceará", "DF": "Distrito Federal", "ES": "Espírito Santo", "GO": "Goiás",
    "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul",
    "MG": "Minas Gerais", "PA": "Pará", "PB": "Paraíba", "PR": "Paraná",
    "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte", "RS": "Rio Grande do Sul", "RO": "Rondônia",
    "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe",
    "TO": "Tocantins"}

NOMES_FONTES = {
    "anp_semanal": "ANP · preços nos postos (semanal)",
    "anp_sintese": "ANP · Síntese Semanal (custos, gasolina A, PPI, anidro)",
    "dolar": "Dólar",
    "brent": "Petróleo Brent",
    "noticias": "Google Notícias",
}
# depois de quantos dias sem dado novo a fonte conta como atrasada
PRAZO = {"anp_semanal": 13, "anp_sintese": 15, "dolar": 5, "brent": 6, "noticias": 3}


def caminho(nome):
    return os.path.join(DADOS, nome)


class Base:
    """A memória do sistema: tudo o que já foi coletado, em dados/*.json."""

    ARQS = {"ufs": "precos_ufs.json", "brasil": "precos_brasil.json",
            "mun": "precos_municipios.json", "detalhe": "detalhe_ultima_semana.json",
            "sinteses": "sinteses.json", "lidas": "sinteses_lidas.json",
            "mercado": "mercado.json", "noticias": "noticias.json",
            "fontes": "fontes.json", "registro": "previsoes_registradas.json",
            "nomes": "nomes_municipios.json", "controle": "controle.json"}

    def __init__(self):
        for k, arq in self.ARQS.items():
            setattr(self, k, ler_json(caminho(arq), {}))

    def gravar(self):
        for k, arq in self.ARQS.items():
            gravar_json(caminho(arq), getattr(self, k), compacto=k in ("mun", "ufs", "mercado"))


# ------------------------------------------------------------------ etapas

def etapa(base, nome, funcao):
    st = base.fontes.setdefault(nome, {})
    st["ultima_tentativa"] = agora().isoformat(timespec="minutes")
    try:
        info = funcao(base) or {}
        st.update(ok=True, erro=None, falhas_seguidas=0,
                  ultimo_sucesso=st["ultima_tentativa"], **info)
        log("OK  ", nome, info.get("msg", ""))
    except Exception as e:
        st.update(ok=False, erro=str(e)[:400],
                  falhas_seguidas=st.get("falhas_seguidas", 0) + 1)
        log("ERRO", nome, e)
        if os.environ.get("GASOLINA_DEPURAR"):
            traceback.print_exc()


def carga_inicial(base):
    log("Primeira carga: histórico completo (pode levar alguns minutos).")
    base.ufs = anp.serie_estados()
    base.brasil = anp.serie_brasil()
    base.mun = anp.serie_municipios(2024)
    base.controle["serie_completa_em"] = hoje().isoformat()


def faltam_semanas(serie, ultimas=12):
    datas = sorted(serie)[-ultimas:]
    for a, b in zip(datas, datas[1:]):
        if (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days > 7:
            return True
    return False


def et_semanal(base):
    resumos = anp.ultimos_resumos()
    ultima = max(base.brasil) if base.brasil else ""
    novos = [(s, u) for s, u in resumos if s > ultima] or resumos[:1]
    for sem, u in sorted(novos):
        cam = baixar_para(u, f"resumo-{sem}.xlsx")
        r = anp.ler_resumo(cam)
        s = r["semana"]
        for uf, v in r["ufs"].items():
            base.ufs.setdefault(uf, {})[s] = v["p"]
        for k, v in r["municipios"].items():
            base.mun.setdefault(k, {})[s] = v["p"]
        base.brasil[s] = r["brasil"]["p"]
        if s >= base.detalhe.get("semana", ""):
            base.detalhe = {"semana": s, "inicio": r["inicio"], "brasil": r["brasil"],
                            "ufs": r["ufs"], "municipios": r["municipios"]}
    # autocura: se ficou buraco (PC desligado muitos dias), rebaixa a série
    ult = base.controle.get("serie_completa_em", "2000-01-01")
    if faltam_semanas(base.brasil) and (hoje() - dt.date.fromisoformat(ult)).days >= 7:
        log("Há semanas faltando; rebaixando a série histórica para tapar o buraco.")
        for uf, serie in anp.serie_estados().items():
            base.ufs.setdefault(uf, {}).update(serie)
        base.brasil.update(anp.serie_brasil())
        base.controle["serie_completa_em"] = hoje().isoformat()
    s = max(base.brasil)
    return {"data_dado": s, "msg": f"semana até {s}"}


def et_sintese(base):
    lista = anp.sinteses_disponiveis(2024)
    feitas, erros = 0, []
    # do mais velho para o mais novo, no máximo 160 de uma vez
    for ano, ed, u in sorted(lista)[-160:]:
        lida = base.lidas.get(u)
        if lida and (lida.get("ok") or lida.get("ignorar")):
            continue
        try:
            cam = baixar_para(u, f"sintese-{ano}-{ed:02d}.pdf", tempo=90)
            s = anp.ler_sintese(cam)
            base.sinteses[s["semana"]] = s
            base.lidas[u] = {"ok": True, "semana": s["semana"]}
            feitas += 1
        except FalhaFonte as e:
            tent = (lida or {}).get("tentativas", 0) + 1
            # edições antigas com layout diferente: desiste delas
            antiga = (ano, ed) < (2024, 20)
            base.lidas[u] = {"ok": False, "erro": str(e)[:200], "tentativas": tent,
                             "ignorar": antiga or tent >= 6}
            if not antiga:
                erros.append(f"{ano}/{ed}: {e}")
        finally:
            try:
                os.remove(os.path.join(CACHE, f"sintese-{ano}-{ed:02d}.pdf"))
            except OSError:
                pass
    if not base.sinteses:
        raise FalhaFonte("nenhuma síntese lida: " + "; ".join(erros[:2]))
    s = max(base.sinteses)
    # se a edição MAIS NOVA não foi lida, é sinal de que o formato mudou
    mais_nova = max(lista)
    st = base.lidas.get(mais_nova[2], {})
    if not st.get("ok"):
        raise FalhaFonte(f"a síntese mais nova ({mais_nova[1]}/{mais_nova[0]}) não pôde ser lida: "
                         + st.get("erro", "?") + f" — usando a de {s}")
    return {"data_dado": s, "msg": f"{feitas} novas; mais recente: semana até {s}"}


def et_dolar(base):
    serie, fonte = mercado.dolar("2023-01-01")
    base.mercado.setdefault("dolar", {}).update(serie)
    base.mercado["fonte_dolar"] = fonte
    d = max(serie)
    if not 2 < serie[d] < 15:
        raise FalhaFonte(f"dólar estranho: {serie[d]}")
    return {"data_dado": d, "msg": f"{fonte}: R$ {serie[d]:.4f} em {d}", "fonte": fonte}


def et_brent(base):
    serie, fonte = mercado.brent("2023-01-01")
    serie = {d: v for d, v in serie.items() if 10 < v < 300}
    base.mercado.setdefault("brent", {}).update(serie)
    base.mercado["fonte_brent"] = fonte
    d = max(serie)
    return {"data_dado": d, "msg": f"{fonte}: US$ {serie[d]:.2f} em {d}", "fonte": fonte}


def et_noticias(base):
    itens = mod_noticias.buscar()
    base.noticias = {"itens": itens, "em": agora().isoformat(timespec="minutes")}
    return {"data_dado": hoje().isoformat(), "msg": f"{len(itens)} manchetes"}


def nomes_ibge(base):
    """Nomes com acento (ANP grava sem acento). Uma vez só; se falhar, segue sem."""
    if base.nomes:
        return
    try:
        import json
        lista = json.loads(baixar("https://servicodados.ibge.gov.br/api/v1/localidades/municipios",
                                  binario=False, tempo=90))
        for m in lista:
            try:
                uf = m["microrregiao"]["mesorregiao"]["UF"]["sigla"]
            except (KeyError, TypeError):
                uf = (m.get("regiao-imediata") or {}).get("regiao-intermediaria", {}).get("UF", {}).get("sigla")
            if uf:
                base.nomes[f"{uf}/{sem_acento(m['nome'])}"] = m["nome"]
        log("nomes de municípios do IBGE:", len(base.nomes))
    except Exception as e:
        log("IBGE indisponível (nomes ficam sem acento):", e)


# ------------------------------------------------------------------ montagem

def valor_em(serie, data):
    """Último valor da série até a data."""
    ds = [d for d in serie if d <= data]
    return serie[max(ds)] if ds else None


def variacao(serie, dias):
    if not serie:
        return None
    d = max(serie)
    ref = valor_em(serie, (dt.date.fromisoformat(d) - dt.timedelta(days=dias)).isoformat())
    return round(serie[d] / ref - 1, 4) if ref else None


def pressao_internacional(base):
    """Defasagem: mercado brasileiro (gasolina A) x preço de importação (PPI).
    O PPI da ANP é semanal; corrigimos até hoje com Brent x dólar."""
    sint = base.sinteses
    if not sint:
        return None
    ppi_all, real_all = {}, {}
    for s in sint.values():
        ppi_all.update({k: v for k, v in s.get("ppi", {}).items() if v})
        real_all.update({k: v for k, v in s.get("realizacao", {}).items() if v})
    if not ppi_all or not real_all:
        return None
    d_ppi = max(ppi_all)
    ppi = ppi_all[d_ppi]
    d_real = max(real_all)
    real = real_all[d_real]
    brent, dolar = base.mercado.get("brent", {}), base.mercado.get("dolar", {})
    ppi_est, d_mer = ppi, d_ppi
    if brent and dolar:
        b0, u0 = valor_em(brent, d_ppi), valor_em(dolar, d_ppi)
        d_mer = min(max(brent), max(dolar))
        b1, u1 = valor_em(brent, d_mer), valor_em(dolar, d_mer)
        if all([b0, u0, b1, u1]) and d_mer > d_ppi:
            ppi_est = ppi * (b1 * u1) / (b0 * u0)
    return {"realizacao": real, "data_realizacao": d_real, "ppi": ppi, "data_ppi": d_ppi,
            "ppi_estimado": round(ppi_est, 3), "data_estimativa": d_mer,
            "defasagem": round(real / ppi_est - 1, 4),
            "defasagem_ppi_anp": round(real / ppi - 1, 4),
            "variacao_ppi_desde_sintese": round(ppi_est - ppi, 3)}


def montar_eventos(cfg, noticias, hoje_):
    saida, avisos = [], []
    for e in cfg.get("eventos", []):
        e = dict(e)
        d = dt.date.fromisoformat(e["data"])
        fim = dt.date.fromisoformat(e["fim"]) if e.get("fim") else None
        e["dias"] = (d - hoje_).days
        if fim and d <= hoje_ <= fim:
            e["andamento"] = True
        if (fim or d) < hoje_:
            if e["status"] == "confirmado":
                e["status"] = "aconteceu"
            elif e["status"] == "depende":
                e["verificar"] = True
                avisos.append(f"O evento \"{e['titulo']}\" era para {d:%d/%m/%Y}. "
                              "Confira se aconteceu ou foi adiado e atualize o calendário.")
        if e.get("busca"):
            chaves = [sem_acento(b) for b in e["busca"]]
            # só conta notícia publicada DEPOIS da última revisão do evento
            revisto = dt.datetime.fromisoformat(e.get("revisado_em", "2000-01-01")).replace(
                tzinfo=agora().tzinfo).timestamp()
            e["noticias"] = [n for n in noticias if n["quando"] > revisto
                             and all(c in sem_acento(n["titulo"]) for c in chaves)][:3]
            if e["noticias"] and e["status"] == "depende" and e["dias"] >= -7:
                e["noticia_alerta"] = True
        saida.append(e)
    saida.sort(key=lambda e: e["data"])
    return saida, avisos


def resumo_sinteses(base):
    out = {"realizacao": {}, "ppi": {}, "golfo": {}, "anidro": {}}
    comp = {}
    for sem in sorted(base.sinteses):
        s = base.sinteses[sem]
        for k in out:
            out[k].update({d: v for d, v in s.get(k, {}).items() if v})
        comp[sem] = s["composicao"]
    return out, comp


def serie_arr(serie, datas):
    return [serie.get(d) for d in datas]


ANUNCIO = re.compile(r"(PETROBRAS|ACELEN|MATARIPE|REFINARIA|REAM|DISTRIBUIDORAS)")
SOBE = re.compile(r"\b(AUMENTA|ELEVA|SOBE|SUBIR|REAJUSTA|REAJUSTE|ALTA|ENCARECE|MAIS CAR)")
DESCE = re.compile(r"\b(REDUZ|REDUCAO|CORTA|CORTE|BAIXA|CAI|QUEDA|RECUA|DIMINUI|MAIS BARAT)")
DUVIDA = re.compile(r"\b(PODE|PODERIA|DEVE|AVALIA|ESTUDA|NEGA|DESCARTA|SE |VAI\?|\?)")


def sinais_noticias(noticias):
    """Manchetes de anúncio de preço (Petrobras, refinarias) dos últimos 10 dias.
    É só um alerta para conferir: manchete não é dado oficial."""
    out = []
    for n in noticias:
        t = sem_acento(n["titulo"])
        if "GASOLINA" not in t or not ANUNCIO.search(t):
            continue
        s, d = bool(SOBE.search(t)), bool(DESCE.search(t))
        if s == d:
            continue
        out.append({"titulo": n["titulo"], "link": n["link"], "fonte": n["fonte"],
                    "quando": n["quando"], "direcao": "sobe" if s else "desce",
                    "especulacao": bool(DUVIDA.search(t + " "))})
    return out[:6]


def gerar_saidas(base, cfg):
    os.makedirs(SAIDA, exist_ok=True)
    comp = previsao.composicoes(base.sinteses)
    if not comp or not base.ufs:
        raise SystemExit("Sem dados suficientes para gerar a previsão.")
    tabela = previsao.tabela_de_chances(base.ufs, comp)
    teste = previsao.avaliar_historico(base.ufs, comp, 52)

    press = pressao_internacional(base)
    hoje_ = hoje()
    noticias = base.noticias.get("itens", [])
    eventos, avisos = montar_eventos(cfg, noticias, hoje_)
    proximos = [{"titulo": e["titulo"], "data": e["data"], "efeito": e["efeito"]}
                for e in eventos
                if e["status"] == "confirmado" and e.get("efeito") and 0 <= e["dias"] <= 7 * previsao.HORIZONTE]
    cenarios = [{"titulo": e["titulo"], "data": e["data"], "efeito": e["efeito"]}
                for e in eventos
                if e["status"] == "depende" and e.get("efeito") and 0 <= e["dias"] <= 60]

    det = base.detalhe
    ufs = {}
    for uf, precos in sorted(base.ufs.items()):
        a = previsao.analisar(precos, comp, tabela, proximos)
        if not a:
            continue
        a.update(nome=NOME_UF_BONITO[uf], regiao=REGIAO[uf],
                 refinaria_privada=cfg.get("refinaria_privada", {}).get(uf),
                 faixa_precos=det.get("ufs", {}).get(uf))
        ufs[uf] = a
    br = previsao.analisar(base.brasil, comp, tabela, proximos)
    br.update(nome="Brasil", faixa_precos=det.get("brasil"))

    # registro "ao vivo": gravado uma vez por semana e nunca reescrito
    semana = br["semana"]
    if semana not in base.registro:
        base.registro[semana] = {uf: {k: a["chances"][k] for k in ("sobe", "desce", "igual")}
                                 for uf, a in ufs.items()}
        base.registro[semana]["BR"] = {k: br["chances"][k] for k in ("sobe", "desce", "igual")}
    ao_vivo = previsao.avaliar_registro(base.registro, {**base.ufs, "BR": base.brasil})

    fontes = []
    for fid, nome in NOMES_FONTES.items():
        st = base.fontes.get(fid, {})
        atrasada = False
        if st.get("data_dado"):
            atrasada = (hoje_ - dt.date.fromisoformat(st["data_dado"][:10])).days > PRAZO[fid]
        fontes.append({"id": fid, "nome": nome, "ok": st.get("ok", False), "erro": st.get("erro"),
                       "ultimo_sucesso": st.get("ultimo_sucesso"), "data_dado": st.get("data_dado"),
                       "fonte": st.get("fonte"), "atrasada": atrasada,
                       "falhas_seguidas": st.get("falhas_seguidas", 0)})
        if not st.get("ok"):
            avisos.append(f"{nome}: a última tentativa falhou; o app usa o último dado bom"
                          + (f" (de {br_data(st['data_dado'])})." if st.get("data_dado") else "."))
        elif atrasada:
            avisos.append(f"{nome}: sem dado novo desde {br_data(st['data_dado'])} (a fonte pode estar atrasada).")
    if br["semana_custo"] != br["semana"]:
        avisos.append("A ANP já publicou os preços da semana, mas os custos (Síntese) ainda não: "
                      f"a conta usa os custos da semana até {br_data(br['semana_custo'])}.")

    serie_s, compl = resumo_sinteses(base)
    ult_comp_sem = max(compl)
    painel = {
        "versao": 2,
        "endereco_publico": (ler_json(os.path.join(RAIZ, "publicacao.json"), {}) or {}).get("endereco"),
        "gerado_em": agora().isoformat(timespec="minutes"),
        "semana": semana, "semana_inicio": det.get("inicio"),
        "brasil": br, "ufs": ufs,
        "composicao": compl[ult_comp_sem], "composicao_semana": ult_comp_sem,
        "pressao": press,
        "mercado": {
            "brent": ultimo(base.mercado.get("brent", {}), "US$/barril"),
            "dolar": ultimo(base.mercado.get("dolar", {}), "R$"),
            "anidro": ultimo(serie_s["anidro"], "R$/L"),
            "realizacao": ultimo(serie_s["realizacao"], "R$/L"),
        },
        "eventos": eventos,
        "cenarios": cenarios,
        "anuncios": sinais_noticias(noticias),
        "noticias": noticias[:20],
        "fontes": fontes,
        "avisos": avisos,
        "modelo": {"tabela": tabela, "teste_ultimo_ano": teste, "ao_vivo": ao_vivo,
                   "horizonte": previsao.HORIZONTE, "limiar": previsao.LIMIAR,
                   "suave": previsao.SUAVE, "ref": previsao.REF},
    }
    gravar_json(os.path.join(SAIDA, "painel.json"), painel, compacto=True)

    semanas = sorted(base.brasil)
    hist = {
        "semanas": semanas,
        "brasil": serie_arr(base.brasil, semanas),
        "ufs": {uf: serie_arr(p, semanas) for uf, p in sorted(base.ufs.items())},
        "sintese": {k: {"d": sorted(v), "v": [v[d] for d in sorted(v)]} for k, v in serie_s.items()},
        "composicao": {"semanas": sorted(compl),
                       **{c: [compl[s][c] for s in sorted(compl)]
                          for c in ("gasolina_a", "anidro", "federais", "icms", "margens", "total")}},
        "mercado": {k: {"d": sorted(v), "v": [v[d] for d in sorted(v)]}
                    for k, v in (("brent", base.mercado.get("brent", {})),
                                 ("dolar", base.mercado.get("dolar", {})))},
    }
    gravar_json(os.path.join(SAIDA, "historico.json"), hist, compacto=True)

    sem_m = sorted({s for p in base.mun.values() for s in p})[-52:]
    lista = []
    ult_sem = det.get("semana")
    for chave, precos in base.mun.items():
        if ult_sem not in precos:      # cidade fora da pesquisa desta semana
            continue
        uf, nome = chave.split("/", 1)
        a = previsao.analisar(precos, comp, tabela, proximos)
        item = {"id": chave, "uf": uf, "nome": base.nomes.get(chave) or nome.title(),
                "p": precos[ult_sem], "faixa_precos": det.get("municipios", {}).get(chave),
                "serie": serie_arr(precos, sem_m)}
        if a:
            item["a"] = a
        lista.append(item)
    lista.sort(key=lambda x: (x["uf"], sem_acento(x["nome"])))
    gravar_json(os.path.join(SAIDA, "municipios.json"), {"semanas": sem_m, "lista": lista}, compacto=True)
    log(f"saídas: semana {semana}; {len(ufs)} Estados; {len(lista)} municípios; "
        f"teste do último ano: {teste}")


def br_data(iso):
    iso = str(iso)[:10]
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}"


def ultimo(serie, unidade):
    if not serie:
        return None
    d = max(serie)
    return {"valor": serie[d], "data": d, "unidade": unidade,
            "var7": variacao(serie, 7), "var30": variacao(serie, 30)}


# ------------------------------------------------------------------ principal

def main():
    os.makedirs(DADOS, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    trava = open(os.path.join(CACHE, ".trava"), "w")
    try:
        import fcntl
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("Outra atualização já está rodando; saindo.")
        return 0
    except ImportError:
        pass

    base = Base()
    cfg = ler_json(os.path.join(RAIZ, "eventos.json"), {})
    if "--reconstruir" in sys.argv or not base.brasil:
        try:
            carga_inicial(base)
        except Exception as e:
            log("ERRO na carga inicial:", e)
            if not base.brasil:
                return 2
    if "--so-saidas" in sys.argv:          # só refaz os arquivos da tela
        gerar_saidas(base, cfg)
        return 0
    nomes_ibge(base)
    etapa(base, "anp_semanal", et_semanal)
    etapa(base, "anp_sintese", et_sintese)
    etapa(base, "dolar", et_dolar)
    etapa(base, "brent", et_brent)
    etapa(base, "noticias", et_noticias)
    base.controle["ultima_execucao"] = agora().isoformat(timespec="minutes")
    base.gravar()
    gerar_saidas(base, cfg)
    base.gravar()           # o registro de previsões é atualizado ao gerar
    try:                    # preço posto a posto (à parte: se falhar, o resto segue)
        import postos
        postos.atualizar()
    except Exception as e:
        log("Postos: falhou:", e)
    try:                    # onde fica cada posto no mapa (só os novos; no máximo 15 min por rodada)
        import locais
        locais.atualizar(limite_min=15)
    except Exception as e:
        log("Locais: falhou:", e)
    falhas = [f for f, st in base.fontes.items() if not st.get("ok")]
    if falhas:
        log("Terminou com fontes falhando:", ", ".join(falhas))
        return 1
    log("Tudo certo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
