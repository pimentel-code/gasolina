"""Onde fica cada posto no mapa (para o mini mapa da aba Postos).

A ANP dá só o endereço. Aqui, com o OpenStreetMap (gratuito):
  1. Overpass: os postos que já estão desenhados no mapa da cidade (com nome e bandeira).
  2. Se um deles tem no nome uma palavra própria do posto da ANP ("Catavento"), é ele.
  3. Senão, Nominatim acha o endereço (às vezes só a rua) e o ponto "encosta" no posto
     desenhado mais próximo (raio pequeno se achou o número, maior se achou só a rua).
  4. Sem posto desenhado perto, fica o ponto do endereço/rua.

Uso educado dos serviços gratuitos: 1 pedido por segundo, tudo guardado em
dados/postos_locais.json (cada posto é procurado UMA vez; os que falharam, de novo após 30 dias).
Saída: site/dados/locais/<UF>.json, sempre os 27 (o Painel trava com arquivo inexistente).

Uso: python3 -I coletor/locais.py [--limite-min 15] [--uf PE]
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from util import DADOS, SAIDA, agora, gravar_json, ler_json, log, sem_acento  # noqa: E402
from anp import UFS as _UFS  # noqa: E402

NOME_UF = {v: k for k, v in _UFS.items()}
UFS = sorted(NOME_UF)
CACHE_LOCAIS = os.path.join(DADOS, "postos_locais.json")
PASTA_POSTOS = os.path.join(SAIDA, "postos")
PASTA_LOCAIS = os.path.join(SAIDA, "locais")
AGENTE = {"User-Agent": "gasolina-app/1.0 (mapa de postos; uso pessoal, 1 pedido/s)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search?"
OVERPASS = "https://overpass-api.de/api/interpreter"
PALAVRAS_COMUNS = set("""POSTO POSTOS AUTO COMERCIO COMERCIAL DERIVADOS DERIVADO PETROLEO PETROLEOS COMBUSTIVEIS
COMBUSTIVEL LTDA EIRELI EPP SERVICOS SERVICO REVENDEDOR REVENDA DISTRIBUIDORA CIA IRMAOS FILHOS FILHO LUBRIFICANTES
LOJA CONVENIENCIA REDE NOSSA SENHORA SANTA SANTO EMPREENDIMENTOS PARTICIPACOES INDUSTRIA TRANSPORTES ABASTECIMENTO
CENTRO CIDADE NOVO NOVA BRASIL GASOLINA ALCOOL DIESEL PETRO MAIS BOM BOA""".split())
MARCAS = {"VIBRA": ("BR", "PETROBRAS", "VIBRA"), "RAIZEN": ("SHELL", "RAIZEN"), "IPIRANGA": ("IPIRANGA",), "ALE": ("ALE",)}

_ultimo = [0.0]


def _pedir(url, dados=None, tempo=60):
    espera = _ultimo[0] + 1.1 - time.time()          # no máximo 1 pedido por segundo
    if espera > 0:
        time.sleep(espera)
    _ultimo[0] = time.time()
    req = urllib.request.Request(url, data=dados, headers=AGENTE)
    for n in range(3):
        try:
            with urllib.request.urlopen(req, timeout=tempo) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or n == 2:
                raise
            time.sleep(20 * (n + 1))
    return None


def distancia_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def palavras_proprias(nome):
    return {w for w in sem_acento(nome).replace(".", " ").replace("-", " ").replace("&", " ").split()
            if len(w) >= 4 and w not in PALAVRAS_COMUNS and not w.isdigit()}


def cidade_info(uf, cid, nome_bonito):
    """Centro, caixa e postos desenhados no OSM de uma cidade."""
    r = _pedir(NOMINATIM + urllib.parse.urlencode({"city": nome_bonito, "state": NOME_UF[uf].title(), "country": "Brasil",
                                                     "format": "jsonv2", "limit": 1}))
    if not r:
        return {"centro": None, "bbox": None, "osm": []}
    s, n, w, e = map(float, r[0]["boundingbox"])
    centro = [float(r[0]["lat"]), float(r[0]["lon"])]
    q = f'[out:json][timeout:90];nwr["amenity"="fuel"]({s},{w},{n},{e});out center tags;'
    osm = []
    try:
        d = _pedir(OVERPASS, urllib.parse.urlencode({"data": q}).encode(), tempo=120) or {}
        for el in d.get("elements", []):
            c = el.get("center", el)
            t = el.get("tags", {})
            if "lat" in c:
                osm.append([round(c["lat"], 6), round(c["lon"], 6), t.get("name", ""), t.get("brand", "") + " " + t.get("operator", "")])
    except Exception as ex:
        log("  Overpass falhou em", cid, ex)
        return {"centro": centro, "bbox": [s, w, n, e], "osm": None}     # None = tentar de novo depois
    return {"centro": centro, "bbox": [s, w, n, e], "osm": osm}


ABREV = [(r"\bAV\b\.?", "AVENIDA"), (r"\bR\b\.", "RUA"), (r"\bPCA\b\.?|\bPC\b\.", "PRACA"), (r"\bPRES\b\.?", "PRESIDENTE"),
         (r"\bGOV\b\.?", "GOVERNADOR"), (r"\bGOVERNARDOR\b", "GOVERNADOR"), (r"\bCEL\b\.?", "CORONEL"), (r"\bDR\b\.?", "DOUTOR"),
         (r"\bENG\b\.?", "ENGENHEIRO"), (r"\bSTA\b\.?", "SANTA"), (r"\bSTO\b\.?", "SANTO"), (r"\bPROF\b\.?", "PROFESSOR"),
         (r"\bTEN\b\.?", "TENENTE"), (r"\bMAL\b\.?", "MARECHAL"), (r"\bROD\b\.?", "RODOVIA"), (r"\bESTR\b\.?", "ESTRADA")]


def normalizar_rua(rua):
    import re
    t = rua.upper()
    for a, b in ABREV:
        t = re.sub(a, b, t)
    t = re.sub(r"^(RUA|AVENIDA)\s+(RUA|AVENIDA)\b", r"\2", t)      # "RUA AV. CLUBE" -> "AVENIDA CLUBE"
    t = re.sub(r"\b(\w+) \1\b", r"\1", t)                       # "RODOVIA RODOVIA" -> "RODOVIA"
    t = re.sub(r"\s+", " ", t).strip(" ,")
    return t


def _nominatim(params, bbox):
    p = dict(params, format="jsonv2", limit=1)
    if "q" in p:
        p["countrycodes"] = "br"            # busca livre não aceita "country" junto
    else:
        p["country"] = "Brasil"
    if bbox:
        s, w, n, e = bbox
        p.update({"viewbox": f"{w},{n},{e},{s}", "bounded": 1})
    r = _pedir(NOMINATIM + urllib.parse.urlencode(p))
    return r[0] if r else None


def achar_endereco(uf, nome_bonito, end, bbox, bairro=""):
    rua = end.split(" (")[0]
    estado = NOME_UF[uf].title()
    tentativas = [rua]
    norm = normalizar_rua(rua)
    if norm != rua.upper():
        tentativas.append(norm)
    if "," in norm:
        tentativas.append(norm.split(",")[0])        # sem o número
    for t in dict.fromkeys(tentativas):
        h = _nominatim({"street": t, "city": nome_bonito, "state": estado}, bbox)
        if h:
            tipo = h.get("addresstype") or h.get("type") or ""
            exato = "," in t and tipo in ("building", "house", "amenity", "shop", "place", "fuel")
            return [float(h["lat"]), float(h["lon"])], ("endereco" if exato else "rua"), tipo
    if bairro and bairro.upper() not in ("CENTRO", "ZONA RURAL", "ZONA URBANA", "RURAL"):
        h = _nominatim({"q": f"{bairro}, {nome_bonito}, {estado}"}, bbox)
        if h:
            return [float(h["lat"]), float(h["lon"])], "aproximado", "bairro"
    return None, None, None


def localizar(posto, info, nome_bonito, uf):
    osm = info.get("osm") or []
    centro = info.get("centro")
    proprias = palavras_proprias(posto["nome"])
    marca = MARCAS.get(posto.get("band", ""), ())
    # 1) posto desenhado com palavra própria do nome (até 25 km do centro da cidade)
    if proprias and centro:
        cands = [o for o in osm if proprias & palavras_proprias(o[2]) and distancia_m(centro, o) < 25000]
        if len(cands) == 1:
            return [cands[0][0], cands[0][1]], "posto", None
    # 2) endereço → encosta no posto desenhado mais próximo
    ponto, prec, tipo = achar_endereco(uf, nome_bonito, posto["end"], info.get("bbox"), posto.get("bairro", ""))
    if not ponto:
        return None, None, None
    if prec == "aproximado":                          # só o bairro: não encosta em posto nenhum
        return ponto, prec, ponto
    raio = 150 if prec == "endereco" else (900 if tipo in ("trunk", "motorway", "primary") or "RODOVIA" in posto["end"] else 500)
    melhor, nota = None, None
    for o in osm:
        d = distancia_m(ponto, o)
        if d > raio:
            continue
        s = d
        txt = sem_acento(o[2] + " " + o[3])
        if marca and any(m in txt.split() for m in marca):
            s *= 0.5
        if proprias & palavras_proprias(o[2]):
            s *= 0.3
        if nota is None or s < nota:
            melhor, nota = o, s
    if melhor:
        return [melhor[0], melhor[1]], "posto", [ponto, prec]
    return ponto, prec, None


def chave(cid, p):
    return f"{cid}|{p['nome']}|{p['end']}"


def gerar_saidas(cache):
    for uf in UFS:
        dados = ler_json(os.path.join(PASTA_POSTOS, uf + ".json"), {}) or {}
        out = {"uf": uf, "centros": {}, "postos": {}}
        for cid, lista in (dados.get("cidades") or {}).items():
            info = cache["cidades"].get(f"{uf}/{cid}") or {}
            if info.get("centro"):
                out["centros"][cid] = [round(x, 5) for x in info["centro"]]
            for p in lista:
                r = cache["postos"].get(f"{uf}|{chave(cid, p)}")
                if r and r.get("ll"):
                    out["postos"][chave(cid, p)] = [round(r["ll"][0], 6), round(r["ll"][1], 6), r["prec"][0]]
        out["n"] = len(out["postos"])
        gravar_json(os.path.join(PASTA_LOCAIS, uf + ".json"), out, compacto=True)


def atualizar(limite_min=None, so_uf=None):
    from util import CACHE
    os.makedirs(CACHE, exist_ok=True)
    trava = open(os.path.join(CACHE, ".trava-locais"), "w")
    try:
        import fcntl
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("Locais: outra busca já está rodando; pulando.")
        return False
    except ImportError:
        pass
    inicio = time.time()
    cache = ler_json(CACHE_LOCAIS, {}) or {}
    cache.setdefault("cidades", {})
    cache.setdefault("postos", {})
    nomes = {c["id"]: c["nome"] for c in (ler_json(os.path.join(SAIDA, "municipios.json"), {}) or {}).get("lista", [])}
    hoje = agora().date().isoformat()
    feitos = falhou = 0
    acabou_tempo = False
    for uf in UFS:
        if so_uf and uf != so_uf:
            continue
        dados = ler_json(os.path.join(PASTA_POSTOS, uf + ".json"), {}) or {}
        for cid, lista in sorted((dados.get("cidades") or {}).items()):
            pend = []
            for p in lista:
                r = cache["postos"].get(f"{uf}|{chave(cid, p)}")
                if r is None or (r.get("ll") is None and r.get("em", "") < _ha_dias(hoje, 30)):
                    pend.append(p)
            if not pend:
                continue
            if limite_min and time.time() - inicio > limite_min * 60:
                acabou_tempo = True
                break
            nome_bonito = nomes.get(f"{uf}/{cid}") or cid.title()
            info = cache["cidades"].get(f"{uf}/{cid}")
            if not info or info.get("osm") is None or info.get("em", "") < _ha_dias(hoje, 60):
                try:
                    info = cidade_info(uf, cid, nome_bonito)
                except Exception as ex:
                    log("  cidade falhou:", uf, cid, ex)
                    continue
                info["em"] = hoje
                cache["cidades"][f"{uf}/{cid}"] = info
            for p in pend:
                try:
                    ll, prec, bruto = localizar(p, info, nome_bonito, uf)
                except Exception as ex:
                    log("  posto falhou:", p["nome"], ex)
                    ll, prec, bruto = None, None, None
                cache["postos"][f"{uf}|{chave(cid, p)}"] = {"ll": ll, "prec": prec, "em": hoje,
                                                            **({"bruto": bruto} if isinstance(bruto, list) and len(bruto) == 2 and isinstance(bruto[1], str) else {})}
                feitos += 1
                falhou += ll is None
            _resolver_repetidos(cache, uf, cid, lista)
            gravar_json(CACHE_LOCAIS, cache)
            log(f"  {uf}/{cid}: {len(pend)} postos")
        if acabou_tempo:
            break
    gerar_saidas(cache)
    total = sum(1 for v in cache["postos"].values() if v.get("ll"))
    log(f"Locais: {feitos} postos procurados agora ({falhou} sem local); {total} no mapa ao todo."
        + (" Parou pelo limite de tempo; continua na próxima rodada." if acabou_tempo else ""))
    return not acabou_tempo


def _resolver_repetidos(cache, uf, cid, lista):
    """Dois postos da ANP no MESMO posto desenhado: fica quem chegou pelo nome ou estava mais perto;
    o outro volta para o ponto do próprio endereço."""
    vistos = {}
    for p in lista:
        r = cache["postos"].get(f"{uf}|{chave(cid, p)}")
        if r and r.get("ll") and r.get("prec") == "posto":
            vistos.setdefault(tuple(r["ll"]), []).append(r)
    for ll, rs in vistos.items():
        if len(rs) < 2:
            continue
        rs.sort(key=lambda r: distancia_m(ll, r["bruto"][0]) if r.get("bruto") else -1)
        for r in rs[1:]:
            if r.get("bruto"):
                r["ll"], r["prec"] = r["bruto"][0], ("aproximado" if r["bruto"][1] == "aproximado" else r["bruto"][1])
            else:
                r["prec"] = "aproximado"


def _ha_dias(iso, n):
    import datetime as dt
    return (dt.date.fromisoformat(iso) - dt.timedelta(days=n)).isoformat()


if __name__ == "__main__":
    lim = None
    if "--limite-min" in sys.argv:
        lim = float(sys.argv[sys.argv.index("--limite-min") + 1])
    uf = sys.argv[sys.argv.index("--uf") + 1] if "--uf" in sys.argv else None
    atualizar(lim, uf)
