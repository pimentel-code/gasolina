#!/usr/bin/env bash
# GASOLINA — app "Gasolina: vai subir ou cair?"
#
#   gasolina              abre o app (pelo Painel de Aplicativos)
#   gasolina atualizar    busca os dados agora (e publica, se o app já estiver no ar)
#   gasolina status       mostra se cada fonte de dados está funcionando
#   gasolina eventos      abre o calendário de impostos/datas para editar
#   gasolina publicar     põe o app na internet (GitHub) e o APK para baixar; "publicar sim" confirma direto
#   gasolina link         mostra o link para mandar a outras pessoas
#   gasolina convite      link + QR da página de convite (passo a passo para instalar)
#   gasolina qr           mostra o QR code para baixar o APK no celular (depois de publicar)
#   gasolina ligar-robo   liga o site e a atualização no GitHub (precisa: gh auth refresh -s workflow)
#   gasolina testar       abre o app num navegador de teste e confere erros
#   gasolina registro     mostra as últimas atualizações automáticas
#   gasolina apk          gera o app Android (Gasolina.apk) e põe uma cópia em ~/Downloads
#   gasolina apk-teste "o que mudou"  publica versão de TESTE (só para quem ligou "versões de teste" no app)
#   gasolina aprovar                  libera para TODOS a última versão de teste
#   gasolina apk-nova "o que mudou"   publica e já libera para todos (apk-teste + aprovar)
#   (os celulares se atualizam sozinhos, como o Prumo: telas sem aviso; APK novo com o botão Atualizar)
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

# ---------------------------------------------------------------- publicar versões (o mesmo jeito do Prumo)
# Cada versão vira uma release v1.N no GitHub com o APK e o miolo.zip (telas/regras).
# Os celulares trocam o miolo SOZINHOS; só pedem para instalar o APK quando a parte
# nativa mudou (marca [nativo:N] na release). Detalhes em site/miolo.js.

publicar_versao() {
  local nota="$1"
  publicado || { echo "Primeiro publique o app: gasolina publicar"; return 1; }
  gh api user >/dev/null 2>&1 || { echo "${ruim}O gh não está logado. Rode: gh auth login${f}"; return 1; }
  echo "${v}Testando antes de publicar…${f}"
  { node testes/miolo.js >/dev/null && node testes/postos.mjs >/dev/null && ./copiar-www.sh && FOTOS=/tmp node testes/apk.js >/dev/null; } \
    || { echo "${ruim}O teste do app falhou: nada foi publicado.${f}"; return 1; }
  git fetch -q --tags origin 2>/dev/null || true
  local atual novo maior nativo ultima tipo
  atual=$(grep -oP '^codigo=\K\d+' android/versao.properties)
  maior=$(git tag -l 'v1.*' | grep -oP '^v1\.\K\d+' | sort -n | tail -1)
  novo=$(( (maior > atual ? maior : atual) + 1 ))       # nunca repete número já usado (nem de teste)
  sed -i "s/^codigo=.*/codigo=$novo/" android/versao.properties
  # A parte nativa mudou desde a última versão? (pasta android/, plugins, configuração)
  ultima=$(git tag -l 'v1.*' --sort=-v:refname | grep -E '^v1\.[0-9]+$' | head -1)
  nativo=$(cat android/nativo-minimo.txt 2>/dev/null || echo "$novo")
  if [ -z "$ultima" ] || ! git diff --quiet "$ultima" -- android capacitor.config.json package.json package-lock.json \
       ':!android/versao.properties' ':!android/nativo-minimo.txt' ':!android/app/src/main/assets' \
     || [ -n "$(git ls-files --others --exclude-standard android capacitor.config.json)" ]; then
    nativo=$novo
  fi
  echo "$nativo" > android/nativo-minimo.txt
  ./montar-apk.sh || return 1
  rm -f miolo.zip
  python3 -I -c "
import zipfile, os
with zipfile.ZipFile('miolo.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for raiz, _, arqs in os.walk('www'):
        for a in arqs:
            c = os.path.join(raiz, a); z.write(c, os.path.relpath(c, 'www'))
"
  cp -f Gasolina.apk ~/Downloads/Gasolina-teste.apk
  [ -n "$nota" ] || nota="Versão 1.$novo"
  git add -A
  git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "Gasolina 1.$novo (teste): $nota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || true
  local t
  for t in 1 2 3; do git pull -q --rebase --autostash -X theirs origin main && git push -q origin main && break; sleep 5; done
  gh release create "v1.$novo" Gasolina.apk miolo.zip -R "$CONTA/$REPO" --prerelease --latest=false \
    --title "Gas 1.$novo (teste)" --notes "$nota

[nativo:$nativo]" || return 1
  if [ "$nativo" = "$novo" ]; then tipo="com parte NATIVA nova: os celulares mostram \"Versão nova\" para instalar o APK"
  else tipo="só telas/regras: os celulares se atualizam sozinhos, sem aviso"; fi
  local link="https://github.com/$CONTA/$REPO/releases/download/v1.$novo/Gasolina.apk"
  echo
  echo "${ok}Publicado para TESTE: Gas 1.$novo${f} ($tipo)."
  echo "Recebem: os celulares com \"Receber versões de teste\" ligado (aba Sobre). A estável não mudou."
  echo "Instalar à mão: $link"
  if command -v qrencode >/dev/null; then
    qrencode -t ANSIUTF8 -m 2 "$link"
    qrencode -s 10 -m 3 -o "$HOME/Downloads/Gasolina-TESTE-QR.png" "$link" && echo "(imagem: ~/Downloads/Gasolina-TESTE-QR.png)"
  fi
  echo "Gostou? Libere para todos com:  gasolina aprovar"
}

aprovar_versao() {
  gh api user >/dev/null 2>&1 || { echo "${ruim}O gh não está logado. Rode: gh auth login${f}"; return 1; }
  local tag="$1" n notas
  [ -n "$tag" ] || tag=$(gh release list -R "$CONTA/$REPO" --limit 30 --json tagName,isPrerelease \
                          --jq '[.[] | select(.isPrerelease) | select(.tagName | test("^v1\\.[0-9]+$"))][0].tagName')
  if [ -z "$tag" ] || [ "$tag" = "null" ]; then echo "Não há versão de teste esperando aprovação."; return 1; fi
  n="${tag#v1.}"
  notas=$(gh release view "$tag" -R "$CONTA/$REPO" --json body --jq .body | sed 's/\[nativo:[0-9]*\]//' | head -c 300)
  gh release edit "$tag" -R "$CONTA/$REPO" --prerelease=false --latest --title "Gas 1.$n" || return 1
  escrever_versao "$n" "$notas"
  git add site/app-versao.json
  git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "Gasolina 1.$n liberada para todos" || true
  local t
  for t in 1 2 3; do git pull -q --rebase --autostash -X theirs origin main && git push -q origin main && break; sleep 5; done
  git fetch -q --tags origin
  git push -q -f origin "$tag^{commit}:refs/heads/estavel"      # o site (quando ligado) sai deste ramo
  echo
  echo "${ok}Liberado para todos: Gas 1.$n.${f}"
  echo "  · os celulares trocam as telas sozinhos; se a versão pede APK novo, aparece \"Versão nova\" com o botão Atualizar"
  mostrar_qr
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

  apk-teste)   # versão de TESTE: só chega a quem ligou "Receber versões de teste" no app
    publicar_versao "${2:-}" ;;

  aprovar)     # libera para TODOS a última versão de teste (ou: gasolina aprovar v1.N)
    aprovar_versao "${2:-}" ;;

  apk-nova)    # publica e já libera para todos (= apk-teste + aprovar)
    publicar_versao "${2:-}" && aprovar_versao "" ;;

  testar-celular)
    node testes/coletor-js.mjs --rede 2>&1 | grep -v '^Warning' && node testes/postos.mjs && ./copiar-www.sh && FOTOS=/tmp node testes/apk.js ;;

  convite)     # página de convite (passo a passo para instalar) — link + QR code
    printf '\n%sMande este link (WhatsApp, e-mail…):%s\n  %shttps://%s.github.io/%s/instalar.html%s\n' "$ok" "$f" "$v" "$CONTA" "$REPO" "$f"
    curl -s -o /dev/null -w '%{http_code}' "https://$CONTA.github.io/$REPO/instalar.html" | grep -q 200 \
      || echo "${a}Atenção: a página ainda não está no ar (o site liga com: gasolina ligar-robo, e precisa de uma versão aprovada que já tenha a página).${f}"
    printf '\n  QR code para imprimir ou mandar como imagem:\n  %s/site/icones/convite-qr.png\n\n' "$PASTA"
    xdg-open "$PASTA/site/icones/convite-qr.png" >/dev/null 2>&1 &
    ;;

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

  ligar-robo)   # liga o site + atualização no GitHub (precisa da permissão "workflow" no login do gh)
    [ -f robo-github/atualizar.yml ] || { echo "O robô já está ligado."; exit 0; }
    if ! gh auth status 2>&1 | grep -q "'workflow'\|workflow"; then
      echo "O login do GitHub neste PC ainda não tem a permissão 'workflow'."
      echo "No terminal (fora do chat do Claude), rode:  gh auth refresh -h github.com -s workflow"
      echo "e depois:  gasolina ligar-robo"; exit 1
    fi
    puxar 2>/dev/null
    mkdir -p .github/workflows && git mv robo-github/atualizar.yml .github/workflows/atualizar.yml && rmdir robo-github 2>/dev/null
    git -c user.email="$EMAIL" -c user.name="pedropimentel" commit -q -m "Liga o robô de atualização e o site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push -q origin main || { echo "${ruim}O GitHub recusou. Confira a permissão 'workflow'.${f}"; exit 1; }
    sleep 3; gh workflow run atualizar.yml -R "$CONTA/$REPO" >/dev/null 2>&1 || true
    echo "${ok}Robô ligado.${f} Em 2 a 5 minutos o site estará em https://$CONTA.github.io/$REPO/" ;;

  *)
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
