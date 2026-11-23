"""Gera os ícones do app a partir do desenho (gota + setas). Rode: python3 gerar-icones.py

Refaz: site/icones (site e celular) e, se existir a pasta android/, os ícones do
Android (comum, redondo, adaptativo), o ícone de notificação e a tela de abertura."""
from pathlib import Path
from PIL import Image, ImageDraw

AZUL = "#184f95"
PASTA = Path(__file__).resolve().parent
RES = PASTA / "android/app/src/main/res"


def icone(tam, margem=0.0, fundo="arredondado"):
    """fundo: 'arredondado', 'cheio', 'redondo' ou None (só o desenho, fundo transparente)."""
    img = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = tam / 64
    if fundo == "cheio":
        d.rectangle([0, 0, tam, tam], fill=AZUL)
    elif fundo == "arredondado":
        d.rounded_rectangle([0, 0, tam - 1, tam - 1], radius=14 * s, fill=AZUL)
    elif fundo == "redondo":
        d.ellipse([0, 0, tam - 1, tam - 1], fill=AZUL)
    k = 1 - margem
    c = tam / 2
    P = lambda x, y: (c + (x - 32) * s * k, c + (y - 32) * s * k)
    # gota: triângulo + círculo
    d.ellipse([P(20, 23)[0], P(20, 23)[1], P(44, 47)[0], P(44, 47)[1]], fill="white")
    d.polygon([P(32, 12), P(21.5, 31), P(42.5, 31)], fill="white")
    w = max(2, int(3.6 * s * k))
    d.line([P(27, 37), P(32, 31), P(37, 37)], fill="#e34948", width=w, joint="curve")
    d.line([P(27, 43), P(32, 48), P(37, 43)], fill="#2a78d6", width=w, joint="curve")
    return img


def grande(tam, margem):   # desenha em 4x e reduz: bordas lisas
    return lambda **kw: icone(tam * 4, margem, **kw).resize((tam, tam), Image.LANCZOS)


ic = PASTA / "site/icones"
for t in (180, 192, 512):
    icone(t).save(ic / f"icone-{t}.png")
icone(512, margem=0.2, fundo="cheio").save(ic / "icone-maskable-512.png")

if RES.exists():
    for dpi, lado in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        pasta = RES / f"mipmap-{dpi}"
        pasta.mkdir(exist_ok=True)
        grande(lado, 0.08)(fundo="arredondado").save(pasta / "ic_launcher.png")
        grande(lado, 0.12)(fundo="redondo").save(pasta / "ic_launcher_round.png")
        # adaptativo: tela de 108dp, só o miolo de 66dp é garantido -> desenho em ~55%
        frente = lado * 108 // 48
        grande(frente, 0.45)(fundo=None).save(pasta / "ic_launcher_foreground.png")
    (RES / "values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{AZUL}</color>\n</resources>\n')
    # ícone de notificação: só a silhueta branca (o Android pinta)
    (RES / "drawable/ic_stat_gasolina.xml").write_text('''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="64" android:viewportHeight="64">
    <path android:fillColor="#FFFFFF" android:fillType="evenOdd"
        android:pathData="M32,10 L19,32 A13,13 0 1,0 45,32 Z M27,40 L32,34 L37,40 L34,40 L32,37.5 L30,40 Z"/>
</vector>
''')
    # tela de abertura: fundo azul + ícone no meio
    for arq in RES.glob("drawable*/splash.png"):
        w, h = Image.open(arq).size
        fundo = Image.new("RGBA", (w, h), AZUL)
        t = round(min(w, h) * 0.32)
        marca = icone(t * 2, 0.0, fundo=None).resize((t, t), Image.LANCZOS)
        fundo.alpha_composite(marca, ((w - t) // 2, (h - t) // 2))
        fundo.convert("RGB").save(arq)
print("ícones gerados")
