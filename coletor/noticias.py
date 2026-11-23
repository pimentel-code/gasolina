"""Manchetes recentes (Google Notícias, RSS público) sobre o que mexe no preço.

Servem para duas coisas: mostrar o que está acontecendo e avisar quando um
evento do calendário (ex.: fim da desoneração) pode ter sido prorrogado."""

import email.utils
import html
import re
import urllib.parse
import xml.etree.ElementTree as ET

from util import agora, baixar, sem_acento

BUSCAS = [
    "preço gasolina Petrobras",
    "gasolina reajuste distribuidoras",
    "desoneração gasolina PIS Cofins",
    "ICMS combustíveis Confaz",
    "Abicom defasagem gasolina",
    "etanol anidro preço usinas",
    "petróleo Brent",
]

ETIQUETAS = [
    ("Petrobras", r"PETROBRAS"),
    ("Impostos", r"ICMS|PIS|COFINS|CIDE|DESONERA|TRIBUT|IMPOSTO|CBS"),
    ("Etanol", r"ETANOL|ANIDRO|USINA|CANA"),
    ("Petróleo", r"PETROLEO|BRENT|OPEP|ORMUZ|BARRIL"),
    ("Refinarias", r"ACELEN|MATARIPE|REFINARIA|ABICOM|IMPORTA"),
]


def buscar(dias=10, maximo=30):
    itens, vistos, erros = [], set(), []
    limite = agora().timestamp() - dias * 86400
    for q in BUSCAS:
        u = ("https://news.google.com/rss/search?hl=pt-BR&gl=BR&ceid=BR:pt-419&q="
             + urllib.parse.quote(q + " when:%dd" % dias))
        try:
            raiz = ET.fromstring(baixar(u, tentativas=2))
        except Exception as e:
            erros.append(str(e))
            continue
        for it in raiz.iter("item"):
            titulo = html.unescape(it.findtext("title") or "").strip()
            fonte = (it.findtext("source") or "").strip()
            if fonte and titulo.endswith(" - " + fonte):
                titulo = titulo[: -len(fonte) - 3]
            chave = re.sub(r"\W+", "", sem_acento(titulo))[:70]
            if not titulo or chave in vistos:
                continue
            try:
                quando = email.utils.parsedate_to_datetime(it.findtext("pubDate")).timestamp()
            except Exception:
                continue
            if quando < limite:
                continue
            vistos.add(chave)
            t = sem_acento(titulo)
            if not re.search(r"GASOLINA|COMBUST|PETROBRAS|PETROLEO|BRENT|ETANOL|ICMS|ABICOM", t):
                continue
            itens.append({
                "titulo": titulo, "fonte": fonte, "link": it.findtext("link"),
                "quando": int(quando),
                "etiquetas": [n for n, p in ETIQUETAS if re.search(p, t)],
            })
    if not itens and erros:
        raise RuntimeError("Google Notícias não respondeu: " + erros[0])
    itens.sort(key=lambda x: -x["quando"])
    return itens[:maximo]
