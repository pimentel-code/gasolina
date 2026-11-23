"""Ferramentas comuns do coletor: download com novas tentativas, leitura de .xlsx
sem bibliotecas externas, datas, JSON estável e registro de erros.

Só usa a biblioteca padrão do Python, para rodar igual no PC e no GitHub."""

import datetime as dt
import gzip
import json
import os
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RAIZ, "cache")
DADOS = os.path.join(RAIZ, "dados")          # base acumulada (memória do sistema)
SAIDA = os.path.join(RAIZ, "site", "dados")  # o que a página lê

AGENTE = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")

try:
    from zoneinfo import ZoneInfo
    FUSO = ZoneInfo("America/Sao_Paulo")
except Exception:                      # sem base de fusos: Brasília é UTC-3 fixo
    FUSO = dt.timezone(dt.timedelta(hours=-3))


def agora():
    return dt.datetime.now(FUSO)


def hoje():
    return agora().date()


def log(*partes):
    print(agora().strftime("%H:%M:%S"), *partes, flush=True)


class FalhaFonte(Exception):
    """A fonte não respondeu ou mudou de formato."""


def baixar(url, tentativas=4, espera=4, tempo=60, binario=True, cabecalhos=None):
    """Baixa com novas tentativas e espera crescente (sites do governo oscilam)."""
    ultimo = None
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": AGENTE,
                "Accept": "*/*",
                "Accept-Language": "pt-BR,pt;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                **(cabecalhos or {})})
            with urllib.request.urlopen(req, timeout=tempo) as r:
                corpo = r.read()
                enc = (r.headers.get("Content-Encoding") or "").lower()
                if enc == "gzip":
                    corpo = gzip.decompress(corpo)
                elif enc == "deflate":
                    corpo = zlib.decompress(corpo)
                if not corpo:
                    raise FalhaFonte("resposta vazia")
                return corpo if binario else corpo.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            ultimo = e
            if e.code in (400, 401, 403, 404, 410):   # não adianta insistir
                break
        except Exception as e:                        # rede, tempo esgotado, etc.
            ultimo = e
        if n < tentativas - 1:
            time.sleep(espera * (n + 1))
    raise FalhaFonte(f"{url} -> {ultimo}")


def baixar_para(url, nome, **kw):
    """Baixa para o cache e devolve o caminho. Grava em .tmp e só troca no fim."""
    os.makedirs(CACHE, exist_ok=True)
    destino = os.path.join(CACHE, nome)
    dados = baixar(url, **kw)
    tmp = destino + ".tmp"
    with open(tmp, "wb") as f:
        f.write(dados)
    os.replace(tmp, destino)
    return destino


# ---------------------------------------------------------------- JSON estável

def ler_json(caminho, padrao=None):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao
    except json.JSONDecodeError:
        # arquivo corrompido (queda de energia no meio da gravação, por ex.)
        os.replace(caminho, caminho + ".corrompido")
        log("AVISO: arquivo corrompido renomeado:", caminho)
        return padrao


def gravar_json(caminho, obj, compacto=False):
    """Grava só se o conteúdo mudou (evita commits inúteis) e de forma atômica."""
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    if compacto:
        texto = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    else:
        texto = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True)
    try:
        with open(caminho, encoding="utf-8") as f:
            if f.read() == texto:
                return False
    except FileNotFoundError:
        pass
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(texto)
    os.replace(tmp, caminho)
    return True


# ---------------------------------------------------------------- textos e datas

def sem_acento(s):
    s = unicodedata.normalize("NFKD", str(s))
    return "".join(c for c in s if not unicodedata.combining(c)).upper().strip()


def data_excel(v):
    """Número de série do Excel (46334) ou texto '08/11/2026' -> 'AAAA-MM-DD'."""
    if v is None:
        return None
    s = str(v).strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        return f"{m[3]}-{m[2]}-{m[1]}"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m[0]
    try:
        n = float(s)
    except ValueError:
        return None
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(n))).isoformat()


def numero(v):
    if v is None:
        return None
    s = str(v).strip().replace("R$", "").replace("%", "").strip()
    if not s or s == "-":
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def data_br(s):
    """'08/11/2026' -> date"""
    d, m, a = s.split("/")
    return dt.date(int(a), int(m), int(d))


# ---------------------------------------------------------------- xlsx sem openpyxl

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NSR = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def planilhas(caminho):
    """Devolve {nome_da_aba: gerador de linhas}. Lê arquivos grandes aos poucos."""
    try:
        z = zipfile.ZipFile(caminho)
    except zipfile.BadZipFile:
        raise FalhaFonte(f"{os.path.basename(caminho)} não é uma planilha .xlsx válida")
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml")):
            if el.tag == _NS + "si":
                ss.append("".join(el.itertext()))
                el.clear()
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    alvo = {r.get("Id"): r.get("Target") for r in rels}
    abas = {}
    for s in wb.iter(_NS + "sheet"):
        t = alvo.get(s.get(_NSR + "id"), "")
        t = t.lstrip("/")
        if not t.startswith("xl/"):
            t = "xl/" + t
        abas[s.get("name")] = t

    def linhas(parte):
        for _, el in ET.iterparse(z.open(parte)):
            if el.tag != _NS + "row":
                continue
            v = {}
            for c in el.findall(_NS + "c"):
                x = c.find(_NS + "v")
                if x is None:
                    t = c.find(_NS + "is")
                    val = "".join(t.itertext()) if t is not None else None
                else:
                    val = ss[int(x.text)] if c.get("t") == "s" else x.text
                ref = c.get("r")
                v[_col(ref) if ref else len(v)] = val
            el.clear()
            if v:
                yield [v.get(i) for i in range(max(v) + 1)]

    return {nome: (lambda p=parte: linhas(p)) for nome, parte in abas.items()}


def tabela(gerador, chaves_cabecalho=("PRODUTO", "DATA FINAL")):
    """Pula o cabeçalho decorativo da ANP e devolve dicts por linha.
    O cabeçalho é a linha em que as células são EXATAMENTE os nomes esperados
    (as observações da ANP também citam "produto" no meio do texto)."""
    cab = None
    for linha in gerador():
        if cab is None:
            textos = [sem_acento(x) if x else "" for x in linha]
            if all(k in textos for k in chaves_cabecalho):
                cab = textos
            continue
        yield {cab[i]: linha[i] for i in range(min(len(cab), len(linha))) if cab[i]}
    if cab is None:
        raise FalhaFonte("cabeçalho da planilha não encontrado (formato mudou?)")


# ---------------------------------------------------------------- PDF -> texto

def pdf_para_texto(caminho):
    try:
        r = subprocess.run(["pdftotext", "-layout", caminho, "-"],
                           capture_output=True, timeout=120)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.decode("utf-8", "replace")
    except FileNotFoundError:
        pass
    try:                                   # plano B, se existir
        import pypdf
        return "\f".join(p.extract_text(extraction_mode="layout") or ""
                         for p in pypdf.PdfReader(caminho).pages)
    except Exception as e:
        raise FalhaFonte(f"não consegui ler o PDF (instale o poppler/pdftotext): {e}")
