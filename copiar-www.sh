#!/usr/bin/env bash
# Monta a pasta www/, que é o que vai dentro do APK:
#   - o site/ (tela) com os dados do dia, para abrir na hora mesmo sem internet
#   - o coletor em JavaScript (coletor-js/) + o leitor de PDF (pdf.js): o celular atualiza sozinho
#   - a base/ (memória do coletor, igual a dados/ do PC) e o calendário (eventos.json)
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www/coletor www/lib www/base
cp -r site/. www/
rm -f www/sw.js www/app-versao.json                 # no app nativo os arquivos já são locais
cp coletor-js/coletor.mjs coletor-js/pdf-texto.mjs coletor-js/postos.mjs www/coletor/
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs www/lib/
cp dados/*.json eventos.json www/base/
codigo=$(grep -oP '^codigo=\K\d+' android/versao.properties 2>/dev/null || echo 1)
echo "window.GASOLINA_APP = { versao: \"1.$codigo\", codigo: $codigo };" > www/versao-app.js
sed -i 's#<script src="nativo.js"></script>#<script src="versao-app.js"></script>\n<script src="nativo.js"></script>#' www/index.html
