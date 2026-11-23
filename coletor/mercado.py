"""Dólar e petróleo Brent, cada um com fontes de reserva.

Dólar:  Banco Central (PTAX)  ->  Yahoo Finance  ->  FRED (EUA)
Brent:  Yahoo Finance (o mais recente)  +  Ipeadata/FRED (histórico, alguns dias de atraso)
"""

import csv
import datetime as dt
import io
import json

from util import FalhaFonte, baixar, log


def _yahoo(simbolo, faixa="1mo"):
    """O Yahoo limita pedidos (erro 429); tenta os dois servidores dele."""
    ultimo = None
    for host in ("query2", "query1"):
        u = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{simbolo}"
             f"?range={faixa}&interval=1d")
        try:
            j = json.loads(baixar(u, binario=False, tentativas=2, espera=8))
            break
        except Exception as e:
            ultimo = e
    else:
        raise FalhaFonte(f"Yahoo indisponível: {ultimo}")
    r = j["chart"]["result"][0]
    datas = [dt.datetime.fromtimestamp(t, dt.timezone.utc).date().isoformat() for t in r["timestamp"]]
    fech = r["indicators"]["quote"][0]["close"]
    return {d: round(v, 4) for d, v in zip(datas, fech) if v}


def _fred(serie, desde="2023-01-01"):
    u = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={serie}&cosd={desde}"
    texto = baixar(u, binario=False, tentativas=3)
    out = {}
    for linha in csv.reader(io.StringIO(texto)):
        if len(linha) == 2 and linha[0][:2] == "20":
            try:
                out[linha[0]] = round(float(linha[1]), 4)
            except ValueError:
                pass
    return out


def dolar(desde="2023-01-01"):
    """{data: R$ por US$}. Tenta as fontes em ordem; devolve (série, fonte_usada)."""
    erros = []
    try:
        ini = dt.date.fromisoformat(desde).strftime("%d/%m/%Y")
        u = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados"
             f"?formato=json&dataInicial={ini}")
        lista = json.loads(baixar(u, binario=False))
        out = {}
        for x in lista:
            d, m, a = x["data"].split("/")
            out[f"{a}-{m}-{d}"] = float(x["valor"])
        if out:
            return out, "Banco Central (PTAX)"
    except Exception as e:
        erros.append(f"BCB: {e}")
    try:
        out = _yahoo("BRL=X", "2y")
        if out:
            return out, "Yahoo Finance (BRL=X)"
    except Exception as e:
        erros.append(f"Yahoo: {e}")
    try:
        out = _fred("DEXBZUS", desde)
        if out:
            return out, "FRED (DEXBZUS)"
    except Exception as e:
        erros.append(f"FRED: {e}")
    raise FalhaFonte("dólar: todas as fontes falharam — " + " | ".join(erros))


def brent(desde="2023-01-01"):
    """{data: US$/barril} juntando histórico + cotação mais recente."""
    serie, fontes, erros = {}, [], []
    try:
        u = ("http://www.ipeadata.gov.br/api/odata4/ValoresSerie"
             "(SERCODIGO='EIA366_PBRENT366')")
        j = json.loads(baixar(u, binario=False, tempo=90))
        for x in j["value"]:
            d = x["VALDATA"][:10]
            if d >= desde and x["VALVALOR"]:
                serie[d] = float(x["VALVALOR"])
        fontes.append("Ipeadata/EIA")
    except Exception as e:
        erros.append(f"Ipeadata: {e}")
        try:
            serie.update(_fred("DCOILBRENTEU", desde))
            fontes.append("FRED/EIA")
        except Exception as e2:
            erros.append(f"FRED: {e2}")
    try:
        recente = _yahoo("BZ=F", "1mo")     # contrato futuro: vem antes do EIA
        for d, v in recente.items():
            if d not in serie or d > max(serie):
                serie[d] = v
        fontes.append("Yahoo (BZ=F)")
    except Exception as e:
        erros.append(f"Yahoo: {e}")
    if not serie:
        raise FalhaFonte("Brent: todas as fontes falharam — " + " | ".join(erros))
    if erros:
        log("Brent com fonte de reserva:", " | ".join(erros))
    return serie, " + ".join(fontes)
