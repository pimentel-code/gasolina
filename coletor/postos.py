"""Preço posto a posto (gasolina, etanol, diesel) — dados abertos da ANP.

A ANP publica, toda semana, as planilhas "últimas 4 semanas" do Levantamento de Preços:
cada linha é um posto visitado, um combustível, a data da visita e o preço.
Cobre as cerca de 420 cidades da pesquisa (as mesmas do app).

Gera site/dados/postos/<UF>.json (um arquivo por Estado, SEMPRE os 27, mesmo vazio:
o Painel trava se a página pedir arquivo que não existe).

REGRA DUPLA: a mesma conta existe em JavaScript (coletor-js/postos.mjs), usada pelo celular.
Mudou aqui, mude lá; `node testes/postos.mjs` compara os dois.
"""
import csv
import io
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from util import AGENTE, CACHE, SAIDA, FalhaFonte, agora, baixar, gravar_json, ler_json, log  # noqa: E402
from anp import UFS as _UFS  # noqa: E402

UFS = sorted(_UFS.values())

PASTA = "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/qus/"
ARQUIVOS = ["ultimas-4-semanas-gasolina-etanol.csv", "ultimas-4-semanas-diesel-gnv.csv"]
PRODUTOS = {"GASOLINA": "gasolina", "GASOLINA ADITIVADA": "aditivada", "ETANOL": "etanol",
            "DIESEL S10": "diesel_s10", "DIESEL": "diesel", "GNV": "gnv"}
DESTINO = os.path.join(SAIDA, "postos")


def tamanho_remoto(url):
    """Tamanho do arquivo na ANP sem baixá-lo (pede só o 1º byte; a ANP recusa HEAD)."""
    req = urllib.request.Request(url, headers={"User-Agent": AGENTE, "Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        cr = r.headers.get("Content-Range") or ""
        return int(cr.rsplit("/", 1)[1]) if "/" in cr else None


def _data_iso(s):
    s = (s or "").strip()
    return f"{s[6:10]}-{s[3:5]}-{s[0:2]}" if len(s) == 10 else ""


def _preco(s):
    try:
        v = float((s or "").strip().replace(".", "").replace(",", "."))
    except ValueError:
        return None
    return v if 1 < v < 20 else None          # descarta erro de digitação


def _limpo(s):
    return " ".join((s or "").replace(";", " ").split())


def montar(textos, tamanhos, gerado_em):
    """textos = conteúdo das 2 planilhas. Devolve {UF: {...}} para todas as UFs."""
    postos = {}                    # (uf, cidade, cnpj) -> posto
    datas = []
    for texto in textos:
        for r in csv.DictReader(io.StringIO(texto.lstrip("﻿")), delimiter=";"):
            prod = PRODUTOS.get(_limpo(r.get("Produto")).upper())
            v, d = _preco(r.get("Valor de Venda")), _data_iso(r.get("Data da Coleta"))
            uf, cid = _limpo(r.get("Estado - Sigla")).upper(), _limpo(r.get("Municipio")).upper()
            if not prod or v is None or not d or uf not in UFS or not cid:
                continue
            cnpj = "".join(c for c in (r.get("CNPJ da Revenda") or "") if c.isdigit())
            chave = (uf, cid, cnpj or _limpo(r.get("Revenda")))
            p = postos.get(chave)
            if p is None:
                num = _limpo(r.get("Numero Rua"))
                end = _limpo(r.get("Nome da Rua"))
                if num and num.upper() not in ("S/N", "SN", "S N", "0"):
                    end += ", " + num
                comp = _limpo(r.get("Complemento"))
                if comp:
                    end += " (" + comp + ")"
                p = postos[chave] = {"nome": _limpo(r.get("Revenda")), "end": end, "bairro": _limpo(r.get("Bairro")),
                                     "band": _limpo(r.get("Bandeira")), "p": {}}
            atual = p["p"].get(prod)
            if atual is None or d > atual[1]:        # vale a visita mais recente
                p["p"][prod] = [v, d]
            datas.append(d)
    saida = {}
    for uf in UFS:
        saida[uf] = {"uf": uf, "gerado_em": gerado_em, "tamanhos": tamanhos,
                     "periodo": {"de": min(datas) if datas else None, "ate": max(datas) if datas else None},
                     "cidades": {}}
    for (uf, cid, cnpj), p in sorted(postos.items()):
        saida[uf]["cidades"].setdefault(cid, []).append(p)
    for uf in saida:
        for cid in saida[uf]["cidades"]:
            saida[uf]["cidades"][cid].sort(key=lambda p: (p["nome"], p["end"]))
    return saida


def atualizar(forcar=False):
    """Baixa as planilhas só quando mudaram. Devolve True se gerou arquivos novos."""
    urls = [PASTA + a for a in ARQUIVOS]
    antigo = ler_json(os.path.join(DESTINO, "SP.json"), {}) or {}
    faltando = any(not os.path.exists(os.path.join(DESTINO, uf + ".json")) for uf in UFS)
    if not forcar and not faltando:
        try:
            tam = [tamanho_remoto(u) for u in urls]
            if None not in tam and tam == antigo.get("tamanhos"):
                log("Postos: planilha da ANP não mudou.")
                return False
        except Exception as e:                         # não conseguiu perguntar: baixa de vez
            log("Postos: não consegui conferir o tamanho:", e)
    corpos = [baixar(u, tempo=120) for u in urls]
    textos = [c.decode("utf-8-sig", "replace") for c in corpos]
    for a, c in zip(ARQUIVOS, corpos):                 # cópia para o teste Python × JS
        os.makedirs(CACHE, exist_ok=True)
        with open(os.path.join(CACHE, a), "wb") as f:
            f.write(c)
    saida = montar(textos, [len(c) for c in corpos], agora().isoformat(timespec="minutes"))
    n = sum(len(x["cidades"]) for x in saida.values())
    if n < 100:                                        # formato mudou? não estraga o que já existe
        raise FalhaFonte(f"planilha de postos com só {n} cidades")
    for uf, obj in saida.items():
        gravar_json(os.path.join(DESTINO, uf + ".json"), obj, compacto=True)
    log(f"Postos: {n} cidades, pesquisa de {saida['SP']['periodo']['de']} a {saida['SP']['periodo']['ate']}.")
    return True


if __name__ == "__main__":
    atualizar("--forcar" in sys.argv)
