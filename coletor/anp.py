"""Tudo que vem da ANP: levantamento semanal de preços (por Estado e município),
séries históricas e a Síntese Semanal (composição do preço, gasolina A, PPI e
etanol anidro).

Os nomes de arquivo da ANP mudam sem aviso (ex.: 'sintese-precos-46-pdf',
'sinteseprecos16.pdf', 'sintese-semanal-precos_2019-ed01.pdf'). Por isso os
endereços são sempre descobertos lendo a página de listagem, nunca montados."""

import html
import re

from util import (FalhaFonte, baixar, baixar_para, data_br, data_excel, log,
                  numero, pdf_para_texto, planilhas, sem_acento, tabela)

BASE = "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos"
PAG_LPC = BASE + "/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
PAG_SERIE = BASE + "/precos-revenda-e-de-distribuicao-combustiveis/serie-historica-do-levantamento-de-precos"
PAG_SINTESE = BASE + "/sintese-semanal-do-comportamento-dos-precos-dos-combustiveis"

UFS = {
    "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM", "BAHIA": "BA",
    "CEARA": "CE", "DISTRITO FEDERAL": "DF", "ESPIRITO SANTO": "ES", "GOIAS": "GO",
    "MARANHAO": "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS",
    "MINAS GERAIS": "MG", "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR",
    "PERNAMBUCO": "PE", "PIAUI": "PI", "RIO DE JANEIRO": "RJ",
    "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS", "RONDONIA": "RO",
    "RORAIMA": "RR", "SANTA CATARINA": "SC", "SAO PAULO": "SP", "SERGIPE": "SE",
    "TOCANTINS": "TO",
}
PRODUTO = "GASOLINA COMUM"


def links(pagina, padrao):
    texto = baixar(pagina, binario=False)
    achados = []
    for h in re.findall(r'href="([^"]+)"', texto):
        h = html.unescape(h)
        if h.startswith("/"):
            h = "https://www.gov.br" + h
        if re.search(padrao, h, re.I) and h not in achados:
            achados.append(h)
    return achados


# ------------------------------------------------------------ levantamento semanal

def ultimos_resumos():
    """Lista [(data_final 'AAAA-MM-DD', url)] dos resumos semanais, do mais novo
    para o mais velho."""
    saida = []
    for u in links(PAG_LPC, r"resumo.*\.xlsx"):
        m = re.search(r"(\d{4})_(\d{2})_(\d{2})-(\d{4})_(\d{2})_(\d{2})", u)
        if m:
            saida.append((f"{m[4]}-{m[5]}-{m[6]}", u))
    if not saida:
        raise FalhaFonte("nenhum resumo semanal encontrado na página da ANP (página mudou?)")
    return sorted(set(saida), reverse=True)


def ler_resumo(caminho):
    """Resumo semanal -> {'semana': fim, 'inicio': ini, 'brasil': {...},
    'regioes': {...}, 'ufs': {UF: {...}}, 'municipios': {'UF/NOME': {...}}}"""
    abas = planilhas(caminho)
    nomes = {sem_acento(k): k for k in abas}

    def aba(chave):
        for n, original in nomes.items():
            if n.startswith(chave):
                return abas[original]
        raise FalhaFonte(f"aba {chave} sumiu do resumo semanal")

    def registro(r):
        return {"p": numero(r.get("PRECO MEDIO REVENDA")),
                "min": numero(r.get("PRECO MINIMO REVENDA")),
                "max": numero(r.get("PRECO MAXIMO REVENDA")),
                "dp": numero(r.get("DESVIO PADRAO REVENDA")),
                "n": int(numero(r.get("NUMERO DE POSTOS PESQUISADOS")) or 0)}

    out = {"ufs": {}, "municipios": {}, "regioes": {}, "brasil": None}
    for r in tabela(aba("ESTADO")):
        if sem_acento(r.get("PRODUTO")) != PRODUTO:
            continue
        uf = UFS.get(sem_acento(r.get("ESTADOS") or r.get("ESTADO")))
        if uf:
            out["ufs"][uf] = registro(r)
            out["semana"] = data_excel(r.get("DATA FINAL"))
            out["inicio"] = data_excel(r.get("DATA INICIAL"))
    for r in tabela(aba("MUNICIPIO")):
        if sem_acento(r.get("PRODUTO")) != PRODUTO:
            continue
        uf = UFS.get(sem_acento(r.get("ESTADO")))
        if uf:
            out["municipios"][f"{uf}/{sem_acento(r.get('MUNICIPIO'))}"] = registro(r)
    for r in tabela(aba("REGI")):
        if sem_acento(r.get("PRODUTO")) == PRODUTO:
            out["regioes"][sem_acento(r.get("REGIAO"))] = registro(r)
    for r in tabela(aba("BRASIL")):
        if sem_acento(r.get("PRODUTO")) == PRODUTO:
            out["brasil"] = registro(r)
    validar_resumo(out)
    return out


def validar_resumo(r):
    if len(r["ufs"]) < 25:
        raise FalhaFonte(f"resumo semanal veio com só {len(r['ufs'])} Estados")
    for uf, v in r["ufs"].items():
        if not v["p"] or not 2.5 < v["p"] < 15:
            raise FalhaFonte(f"preço estranho para {uf}: {v['p']}")
    if not r.get("brasil") or not r.get("semana"):
        raise FalhaFonte("resumo semanal sem a média Brasil ou sem a data")


# ------------------------------------------------------------ séries históricas

def serie_estados():
    """Semanal por Estado desde 2013 (arquivo grande, só na primeira carga)."""
    u = [x for x in links(PAG_SERIE, r"semanal-estados-desde.*\.xlsx")]
    if not u:
        raise FalhaFonte("série histórica por Estado não encontrada")
    log("baixando série histórica por Estado (≈12 MB)…")
    cam = baixar_para(u[0], "serie-estados.xlsx", tempo=300)
    serie = {}
    for r in tabela(list(planilhas(cam).values())[0]):
        if sem_acento(r.get("PRODUTO")) != PRODUTO:
            continue
        uf = UFS.get(sem_acento(r.get("ESTADO")))
        sem = data_excel(r.get("DATA FINAL"))
        p = numero(r.get("PRECO MEDIO REVENDA"))
        if uf and sem and p:
            serie.setdefault(uf, {})[sem] = round(p, 3)
    return serie


def serie_brasil():
    u = [x for x in links(PAG_SERIE, r"semanal-brasil-desde.*\.xlsx")]
    if not u:
        raise FalhaFonte("série histórica Brasil não encontrada")
    cam = baixar_para(u[0], "serie-brasil.xlsx", tempo=300)
    serie = {}
    for r in tabela(list(planilhas(cam).values())[0]):
        if sem_acento(r.get("PRODUTO")) == PRODUTO:
            sem = data_excel(r.get("DATA FINAL"))
            p = numero(r.get("PRECO MEDIO REVENDA"))
            if sem and p:
                serie[sem] = round(p, 3)
    return serie


def serie_municipios(ano_min=2024):
    """Semanal por município (arquivos por período). Usa só os recentes."""
    saida = {}
    for u in links(PAG_SERIE, r"semanal-munic.*\.xlsx?$"):
        anos = [int(a) for a in re.findall(r"(20\d{2})", u.rsplit("/", 1)[-1])]
        if not anos or max(anos) < ano_min or u.endswith(".xls"):
            continue
        nome = "serie-" + u.rsplit("/", 1)[-1]
        log("baixando", nome, "…")
        cam = baixar_para(u, nome, tempo=300)
        for r in tabela(list(planilhas(cam).values())[0]):
            if sem_acento(r.get("PRODUTO")) != PRODUTO:
                continue
            uf = UFS.get(sem_acento(r.get("ESTADO")))
            sem = data_excel(r.get("DATA FINAL"))
            p = numero(r.get("PRECO MEDIO REVENDA"))
            if uf and sem and p:
                saida.setdefault(f"{uf}/{sem_acento(r.get('MUNICIPIO'))}", {})[sem] = round(p, 3)
    return saida


# ------------------------------------------------------------ síntese semanal

def sinteses_disponiveis(ano_min=2024):
    """[(ano, edição, url)] do mais novo para o mais velho."""
    saida = []
    for u in links(PAG_SINTESE, r"arq-sintese-semanal/20\d\d/"):
        m = re.search(r"arq-sintese-semanal/(20\d\d)/(.+)$", u)
        if not m or "comunicado" in m[2]:
            continue
        ano = int(m[1])
        nums = re.findall(r"(\d{1,2})(?!\d)", re.sub(r"20\d\d", "", m[2]))
        if ano < ano_min or not nums:
            continue
        saida.append((ano, int(nums[0]), u))
    if not saida:
        raise FalhaFonte("nenhuma síntese semanal encontrada (página mudou?)")
    return sorted(set(saida), reverse=True)


_DATA = r"(\d{2}/\d{2}/\d{4})"
_NUM = r"(-?\d{1,3}(?:\.\d{3})*,\d+)"


def ler_sintese(caminho):
    """Lê a página da gasolina da Síntese Semanal."""
    texto = pdf_para_texto(caminho)
    paginas = texto.split("\f")
    pag = next((p for p in paginas if "REALIZA" in p.upper() and "GASOLINA" in p.upper()), None)
    if pag is None:
        raise FalhaFonte("síntese sem a página de gasolina/realização")
    s = {}
    m = re.search(r"Semana de\s+" + _DATA + r"\s+a\s+" + _DATA, texto)
    if not m:
        raise FalhaFonte("síntese sem a semana")
    s["inicio"], s["semana"] = data_br(m[1]).isoformat(), data_br(m[2]).isoformat()
    m = re.search(r"Edi[cç][aã]o\s+(\d+)/(\d{4})", texto)
    s["edicao"] = f"{m[1]}/{m[2]}" if m else None

    secoes = {"revenda": {}, "distribuicao": {}, "realizacao": {}, "ppi": {},
              "golfo": {}, "anidro": {}}
    grupo = re.compile(_DATA + r"\s+" + _NUM + r"%?\s+" + _NUM + r"%?")
    atual = None
    for linha in pag.splitlines():
        u = sem_acento(linha)
        if "COMPOSICAO DO PRECO" in u:
            break
        if "REVENDA - SEMANA" in u:
            atual = "revenda"
        elif "DISTRIBUICAO - SEMANA" in u:
            atual = "distribuicao"
        elif "REALIZACAO" in u:
            atual = "realizacao"
        elif "COTACAO INTERNACIONAL" in u:
            atual = "ppi"
        elif "ETANOL ANIDRO" in u and "COTACAO" not in u:
            atual = "anidro"
        if not atual:
            continue
        achados = list(grupo.finditer(linha))
        if not achados:
            continue
        if atual in ("revenda", "distribuicao"):
            ordem = [atual]
        elif len(achados) > 1:            # layout 2024-2025: três tabelas lado a lado
            ordem = ["realizacao", "ppi", "anidro"]
        else:                             # layout 2026: uma tabela embaixo da outra
            ordem = [atual]
        for g, sec in zip(achados, ordem):
            d = data_br(g[1]).isoformat()
            if sec == "ppi":
                secoes["golfo"][d] = numero(g[2])
                secoes["ppi"][d] = numero(g[3])
            else:
                secoes[sec][d] = numero(g[2])
    s.update(secoes)

    # composição: valores "R$ x,xx" do bloco, menos os das capitais ("Cidade | R$")
    i = texto.find("Composição do preço")
    j = texto.find("Preços médios de revenda da gasolina", i)
    bloco = texto[i:j if j > 0 else i + 6000] if i >= 0 else ""
    vals = [numero(v) for v in re.findall(r"(?<!\|)\s+R\$\s*(\d+,\d{2})", bloco)]
    if len(vals) >= 6:
        total, marg, est, fed, anid, gasA = vals[:6]
        soma = marg + est + fed + anid + gasA
        if abs(soma - total) <= 0.03:
            s["composicao"] = {"total": total, "margens": marg, "icms": est,
                               "federais": fed, "anidro": anid, "gasolina_a": gasA}
    if "composicao" not in s:
        raise FalhaFonte("não reconheci a composição do preço na síntese (formato mudou?)")
    validar_sintese(s)
    return s


def validar_sintese(s):
    c = s["composicao"]
    faixas = {"gasolina_a": (0.8, 6), "anidro": (0.3, 3), "icms": (0.5, 3),
              "federais": (0, 2), "margens": (0.2, 3.5), "total": (3, 12)}
    for k, (a, b) in faixas.items():
        if not a <= c[k] <= b:
            raise FalhaFonte(f"síntese: valor fora do normal em {k}: {c[k]}")
    for k in ("realizacao", "ppi", "anidro"):
        for d, v in s[k].items():
            if v is None or not 0.5 < v < 10:
                raise FalhaFonte(f"síntese: {k} em {d} = {v}")
