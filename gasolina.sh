#!/usr/bin/env bash
# GASOLINA — app "Gasolina: vai subir ou cair?"
#
#   gasolina              abre o app (pelo Painel de Aplicativos)
#   gasolina atualizar    busca os dados agora (e publica, se o app já estiver no ar)
#   gasolina status       mostra se cada fonte de dados está funcionando
#   gasolina eventos      abre o calendário de impostos/datas para editar
#   gasolina publicar     põe o app na internet (GitHub) e o APK para baixar; "publicar sim" confirma direto
#   gasolina link         mostra o link para mandar a outras pessoas
#   gasolina qr           mostra o QR code para baixar o APK no celular (depois de publicar)
#   gasolina testar       abre o app num navegador de teste e confere erros
#   gasolina registro     mostra as últimas atualizações automáticas
#   gasolina apk          gera o app Android (Gasolina.apk) e põe uma cópia em ~/Downloads
#   gasolina apk-nova "o que mudou"   publica versão nova do APK (os celulares são avisados)
#   gasolina testar-celular  confere o coletor do celular contra o do PC e simula o app (precisa de internet)
#   gasolina sincronizar  (usado pelo relógio automático, 2x por dia)

set -uo pipefail
PASTA="$HOME/Projetos/Sistemas/Gasolina"
REPO="gasolina"
CONTA="pimentel-code"
EMAIL="235394033+pimentel-code@users.noreply.github.com"
REGISTRO="$HOME/.local/state/gasolina/atualizacoes.log"
v=$'\e[1;36m'; ok=$'\e[1;32m'; ruim=$'\e[1;31m'; a=$'\e[1;33m'; f=$'\e[0m'

mkdir -p "$(dirname "$REGISTRO")"
cd "$PASTA" || { echo "Não achei $PASTA"; exit 1; }

publicado() { git remote get-url origin >/dev/null 2>&1; }

puxar() {    # traz o que o GitHub atualizou. Os dados locais são refeitos, então podem ser descartados;
             # outras edições (ex.: eventos.json) ficam guardadas com --autostash.
  git checkout -- dados site/dados 2>/dev/null
  git pull -q --rebase --autostash -X theirs origin main
}

LINK_APK="https://github.com/$CONTA/$REPO/releases/latest/download/Gasolina.apk"

mostrar_qr() {   # QR code para o celular baixar o APK (aparece no terminal e numa imagem)
  echo "App Android (link fixo, sempre a versão mais nova):"
  echo "  $LINK_APK"
  if command -v qrencode >/dev/null; then
    echo "Aponte a câmera do celular para o QR code:"
    qrencode -t ANSIUTF8 -m 2 "$LINK_APK"
    qrencode -s 10 -m 3 -o "$HOME/Downloads/Gasolina-baixar-app-QR.png" "$LINK_APK" \
      && echo "(imagem do QR code: ~/Downloads/Gasolina-baixar-app-QR.png)"
  fi
}

escrever_versao() {   # site/app-versao.json: o app instalado compara com a própria versão e avisa
  printf '{"codigo": %s, "versao": "1.%s", "novidades": %s, "apk": "%s"}\n' \
    "$1" "$1" "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$2")" "$LINK_APK" > site/app-versao.json
}

avisar() {   # notificação na área de trabalho (se houver sessão gráfica)
  command -v notify-send >/dev/null && notify-send -a Gasolina -i "$PASTA/site/icones/icone-192.png" "$1" "$2" 2>/dev/null || true
}

coletar() {
  python3 -I coletor/atualizar.py
  local cod=$?
  if [ $cod -eq 2 ]; then
    avisar "Gasolina: atualização falhou" "Nenhum dado novo. Rode 'gasolina status' para ver o motivo."
  elif [ $cod -eq 1 ]; then
    # só incomoda se a mesma fonte falhar 4 vezes seguidas (2 dias)
    python3 -I - <<'EOF' && avisar "Gasolina: uma fonte está falhando há 2 dias" "Rode 'gasolina status'. O app segue com o último dado bom."
import json, sys
f = json.load(open("dados/fontes.json"))
sys.exit(0 if any(v.get("falhas_seguidas", 0) >= 4 for v in f.values()) else 1)
EOF
  fi
  return $cod
}

enviar() {   # manda os dados novos para o GitHub (o site se atualiza sozinho)
  publicado || return 0
  git add dados site/dados eventos.json >/dev/null 2>&1
  if git diff --cached --quiet; then echo "Nada novo para publicar."; return 0; fi
  git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "Dados atualizados no PC ($(date '+%d/%m %H:%M'))"
  for t in 1 2 3; do
    git pull -q --rebase --autostash -X theirs origin main && git push -q origin main && { echo "${ok}Publicado.${f}"; return 0; }
    sleep 5
  done
  echo "${ruim}Não consegui enviar ao GitHub (sem internet?). Tento de novo na próxima vez.${f}"
}

case "${1:-abrir}" in
  abrir)
    exec painel gasolina ;;

  atualizar)
    echo "${v}Buscando dados…${f}"
    publicado && puxar 2>/dev/null
    coletar; enviar ;;

  sincronizar)   # relógio automático
    {
      echo "== $(date '+%d/%m/%Y %H:%M')"
      if publicado; then
        puxar 2>&1
        # o GitHub atualiza sozinho; o PC só entra se o site estiver parado há mais de 20 h
        idade=$(python3 -I -c "
import json,datetime as d
g=json.load(open('site/dados/painel.json'))['gerado_em']
print(int((d.datetime.now(d.timezone.utc)-d.datetime.fromisoformat(g)).total_seconds()//3600))" 2>/dev/null || echo 999)
        if [ "$idade" -ge 20 ]; then
          echo "Site parado há ${idade} h: o PC assume a atualização."
          coletar; enviar
        else
          echo "Site em dia (${idade} h); só copiei os dados para o PC."
        fi
      else
        coletar
      fi
    } >> "$REGISTRO" 2>&1
    tail -c 200000 "$REGISTRO" > "$REGISTRO.tmp" && mv "$REGISTRO.tmp" "$REGISTRO" ;;

  status)
    python3 -I - <<'EOF'
import json
p = json.load(open("site/dados/painel.json"))
print(f"Atualizado em {p['gerado_em'][:16].replace('T',' ')} · preços da semana até {p['semana']}")
for f in p["fontes"]:
    s = "✕ FALHOU" if not f["ok"] else "⚠ atrasada" if f["atrasada"] else "✓ ok"
    print(f"  {s:11s} {f['nome']}  (dado de {str(f['data_dado'])[:10]})" + (f"\n              {f['erro']}" if f.get("erro") else ""))
for a in p["avisos"]:
    print("  ⚠", a)
EOF
    ;;

  eventos)
    echo "Abra, edite e salve; depois rode: gasolina atualizar"
    xdg-open "$PASTA/eventos.json" >/dev/null 2>&1 & ;;

  registro)
    tail -n 40 "$REGISTRO" ;;

  testar)
    node testes/tela.js "${2:-http://127.0.0.1:8100/pagina/gasolina/}" ;;

  apk)
    ./montar-apk.sh || exit 1
    cp -f Gasolina.apk ~/Downloads/Gasolina.apk && echo "Cópia em ~/Downloads/Gasolina.apk (dá para mandar pelo WhatsApp e instalar no celular)." ;;

  apk-nova)
    publicado || { echo "Primeiro publique o app: gasolina publicar"; exit 1; }
    gh api user >/dev/null 2>&1 || { echo "${ruim}O gh não está logado. Rode: gh auth login${f}"; exit 1; }
    node testes/coletor-js.mjs >/dev/null 2>&1 && ./copiar-www.sh && FOTOS=/tmp node testes/apk.js >/dev/null || { echo "${ruim}O teste do app falhou: nada foi publicado.${f}"; exit 1; }
    atual=$(grep -oP '^codigo=\K\d+' android/versao.properties); novo=$((atual + 1))
    sed -i "s/^codigo=.*/codigo=$novo/" android/versao.properties
    ./montar-apk.sh || exit 1
    cp -f Gasolina.apk ~/Downloads/Gasolina.apk
    nota="${2:-Versão 1.$novo}"
    escrever_versao "$novo" "$nota"
    puxar 2>/dev/null
    git add -A
    git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "App Android 1.$novo: $nota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push -q origin main || { echo "${ruim}Não consegui enviar ao GitHub.${f}"; exit 1; }
    gh release create "v1.$novo" Gasolina.apk -R "$CONTA/$REPO" --title "Gasolina 1.$novo" --notes "$nota" --latest || exit 1
    echo "${ok}Publicado: Gasolina 1.$novo.${f} Quem tem o app vê o aviso \"Saiu a versão nova\" ao abrir."
    mostrar_qr ;;

  testar-celular)
    node testes/coletor-js.mjs --rede 2>&1 | grep -v '^Warning' && ./copiar-www.sh && FOTOS=/tmp node testes/apk.js ;;

  link)
    if publicado; then echo "https://$CONTA.github.io/$REPO/"; echo "Para uma cidade: https://$CONTA.github.io/$REPO/?local=PE/PETROLINA"
      echo "App Android: https://github.com/$CONTA/$REPO/releases/latest/download/Gasolina.apk"
    else echo "O app ainda não foi publicado. Rode: gasolina publicar"; fi ;;

  publicar)
    if publicado; then echo "Já está publicado: https://$CONTA.github.io/$REPO/"; mostrar_qr; exit 0; fi
    echo "${v}Publicar o app na internet${f}"
    echo "Isto vai:"
    echo "  1. criar o repositório PÚBLICO github.com/$CONTA/$REPO (código + dados da ANP; nada pessoal)"
    echo "  2. pôr o APK para baixar no celular: link fixo + QR code"
    echo "  3. ligar o site https://$CONTA.github.io/$REPO/ (para quem não tem Android)"
    echo "  4. ligar a atualização automática do site no GitHub (07:15 e 19:15)"
    # "gasolina publicar sim" confirma direto (o "!" do chat do Claude não deixa digitar a resposta)
    if [[ "${2:-}" =~ ^(sim|s|-s)$ ]]; then r=s; else read -r -p "Continuar? [s/N] " r || r=""; fi
    [[ "$r" =~ ^[sS] ]] || { echo "Nada foi feito. (Para confirmar direto: gasolina publicar sim)"; exit 0; }
    gh api user >/dev/null 2>&1 || { echo "${ruim}O gh não está logado. Rode: gh auth login${f}"; exit 1; }
    gh repo view "$CONTA/$REPO" >/dev/null 2>&1 && { echo "${ruim}Já existe um repositório $CONTA/$REPO no GitHub. Nada foi feito.${f}"; exit 1; }
    printf '{"endereco": "https://%s.github.io/%s/"}\n' "$CONTA" "$REPO" > publicacao.json
    python3 -I coletor/atualizar.py --so-saidas >/dev/null 2>&1
    codigo=$(grep -oP '^codigo=\K\d+' android/versao.properties)
    escrever_versao "$codigo" "Primeira versão"
    echo "${v}Montando o APK…${f}"
    ./montar-apk.sh >/dev/null || { echo "${ruim}Não consegui montar o APK. Nada foi publicado.${f}"; exit 1; }
    cp -f Gasolina.apk ~/Downloads/Gasolina.apk
    git add -A
    git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "App Gasolina: vai subir ou cair?

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || true
    echo "${v}Criando o repositório…${f}"
    gh repo create "$CONTA/$REPO" --public --description "Preço da gasolina por Estado e cidade, chance de subir ou cair e os motivos (dados da ANP)" || exit 1
    # o site (Pages) é ligado ANTES do primeiro envio, para o robô já publicar de primeira
    gh api -X POST "repos/$CONTA/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
      || gh api -X PUT "repos/$CONTA/$REPO/pages" -f build_type=workflow >/dev/null 2>&1
    git remote add origin "https://github.com/$CONTA/$REPO.git" 2>/dev/null || git remote set-url origin "https://github.com/$CONTA/$REPO.git"
    git push -q -u origin main || { echo "${ruim}Não consegui enviar ao GitHub.${f}"; exit 1; }
    echo "${v}Pondo o APK para baixar…${f}"
    gh release create "v1.$codigo" Gasolina.apk -R "$CONTA/$REPO" --title "Gasolina 1.$codigo" --notes "Primeira versão do app Android." --latest || exit 1
    gh workflow run atualizar.yml -R "$CONTA/$REPO" >/dev/null 2>&1 || true
    echo
    echo "${ok}Pronto!${f}"
    mostrar_qr
    echo "Site (em 2 a 5 minutos): https://$CONTA.github.io/$REPO/" ;;

  qr)
    mostrar_qr ;;

  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
