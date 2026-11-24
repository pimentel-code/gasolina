# Gasolina: vai subir ou cair?

App que acompanha o preço da gasolina comum no Brasil, nos 27 Estados e em cerca de 400 cidades.
Ele mostra a chance de subir ou cair nas próximas 3 semanas e **por quê**. Usa dados oficiais da ANP,
o dólar do Banco Central, o petróleo Brent e as notícias, e se atualiza sozinho duas vezes por dia.

Feito em 22/11/2026, a partir do levantamento `~/Projetos/Pesquisas/gasolina-fatores-de-preco.md`.

## Como usar

| Quero… | Faço |
|---|---|
| Abrir o app | Painel de Aplicativos → **Gasolina**, ou digite `gasolina` no terminal |
| Atualizar agora | `gasolina atualizar` |
| Ver se as fontes estão funcionando | `gasolina status` (também fica no fim da página do app) |
| Corrigir o calendário (ex.: governo prorrogou a desoneração) | `gasolina eventos`, edite, salve e rode `gasolina atualizar` |
| Ver o que o relógio automático fez | `gasolina registro` |
| Conferir a tela num navegador de teste | `gasolina testar` |
| Compartilhar com outras pessoas | `gasolina publicar` (uma vez só), depois `gasolina link` |
| Gerar o app Android (APK) | `gasolina apk` → `Gasolina.apk` aqui e em `~/Downloads` |
| Publicar versão nova do APK | `gasolina apk-nova "o que mudou"` (só depois de publicar o site) |
| Testar o app Android | `gasolina testar-celular` |

## Compartilhar com outras pessoas

O app no Painel só funciona no seu PC (endereço 127.0.0.1). Para mandar a outras pessoas,
ele vai para o **GitHub Pages**, igual ao Prumo:

1. Rode `gasolina publicar` e responda `s`. Isso:
   - cria o repositório **público** `github.com/pimentel-code/gasolina`, com o código e os dados da ANP, sem nada pessoal; os commits usam o e-mail-máscara do GitHub;
   - liga o site em **https://pimentel-code.github.io/gasolina/**;
   - liga o robô do GitHub, que atualiza os dados às 07:15 e às 19:15, **mesmo com o PC desligado**.
2. Em 2 a 5 minutos o link funciona. Mande pelo WhatsApp: o botão **Compartilhar** do app já monta a mensagem com o preço e o link.
3. O link pode abrir direto num lugar: `…/gasolina/?local=PE` (Estado) ou `…/gasolina/?local=PE/PETROLINA` (cidade).
4. No celular dá para **instalar** como aplicativo: no Android, "Adicionar à tela inicial"; no iPhone, Compartilhar → "Adicionar à Tela de Início". Funciona sem internet, mostrando os últimos dados.

Custa zero: site público no GitHub Pages e robô gratuito para repositório público.
Quem abre o app não deixa dado nenhum. O app só guarda no próprio aparelho o último lugar escolhido.

## App Android (APK)

Feito em 22/11/2026 com o Capacitor, o mesmo kit do Prumo. É o mesmo app do site, embalado.
Ele ocupa 4,3 MB, roda no Android 7 ou mais novo e se chama `io.github.pimentelcode.gasolina`.

**Instalar pelo GitHub (o jeito principal):** rode `gasolina publicar` uma vez. Ele cria o repositório
e põe o APK num link fixo, e no fim mostra um **QR code** (também salvo em `~/Downloads/Gasolina-baixar-app-QR.png`).
No celular, aponte a câmera para o QR code ou abra o link. O Chrome baixa o arquivo. Toque em "Abrir" e permita
"instalar apps desta fonte" para o Chrome, só na primeira vez. Para ver o QR code de novo: `gasolina qr`.
Versão nova: `gasolina apk-nova "o que mudou"`. O link continua o mesmo, e o app instalado avisa "Saiu a versão nova".
**Situação em 22/11/2026:** publicado. O repositório é github.com/pimentel-code/gasolina e o APK é a release v1.1.
O link fixo funciona: o arquivo baixado é idêntico ao do PC. O **robô do GitHub e o site ainda estão DESLIGADOS**:
o login do `gh` não tem a permissão `workflow`, então o arquivo do robô está guardado em `robo-github/`.
Para ligar: `gh auth refresh -h github.com -s workflow` no terminal e depois `gasolina ligar-robo`.
Enquanto isso, o relógio do PC atualiza os dados do repositório (o calendário que o celular lê vem de lá).
**Sem publicar:** mande `~/Downloads/Gasolina.apk` pelo WhatsApp ou pelo cabo e toque nele.
Depois de publicado, o link fixo é `https://github.com/pimentel-code/gasolina/releases/latest/download/Gasolina.apk`
e aparece também no rodapé do site. Também dá para acompanhar pelo Obtainium, colando o endereço do repositório.

**De onde vêm os dados no celular (desde 22/11/2026, versão "atualiza sozinho"):**
O **próprio celular** busca nas fontes oficiais e recalcula a previsão. Não depende do PC nem de site publicado.
- Quando: ao abrir o app e ao voltar para ele, se a última busca tiver mais de 3 h. Também pelo botão **Atualizar agora**.
- O quê: as mesmas 5 fontes do PC, todas ao mesmo tempo, em cerca de 20 s:
  - a planilha semanal da ANP;
  - o PDF da Síntese, lido pelo pdf.js;
  - o dólar do Banco Central;
  - o Brent (Ipeadata e Yahoo);
  - o Google Notícias.
- Como: o coletor do PC foi traduzido para JavaScript em `coletor-js/coletor.mjs`. No celular, ele baixa pelo HTTP nativo do Android
  (`CapacitorHttp`, que não sofre o bloqueio de CORS) e guarda tudo no aparelho (IndexedDB), gravando tudo de uma vez só.
- Primeira abertura: o APK traz a base inteira (`base/` = `dados/` do PC no dia em que foi gerado). Por isso o app
  funciona na hora e só baixa o que é novo: 1 planilha e 1 PDF por semana, no máximo alguns MB.
- Sem internet: ele percebe em segundos, avisa "Sem internet agora" e mantém os últimos dados guardados.
- Calendário (`eventos.json`): vem dentro do APK. Se o projeto for publicado no GitHub, o app também busca a versão
  editada no PC (`raw.githubusercontent.com/pimentel-code/gasolina/main/eventos.json`). Sem publicar, uma mudança no calendário só chega ao celular com um APK novo (`gasolina apk`).
- **Regra dupla:** o coletor existe em Python (PC) e em JavaScript (celular). Se mudar uma regra num, mude no outro.
  O `node testes/coletor-js.mjs` compara os dois. Em 22/11/2026, os resultados foram **idênticos**:
  - a planilha;
  - 8 PDFs de 2024, 2025 e 2026;
  - `painel.json`, `historico.json` e `municipios.json`;
  - uma semana apagada e recuperada pela internet.
- Ainda não faz: buscar com o app **fechado** (o Android limita tarefas em segundo plano). Abrir o app é o que dispara a busca.

**O que muda em relação ao site:**
- Compartilhar abre o menu do Android (WhatsApp etc.) com o link do site. Se o site não estiver no ar, vai só o texto.
- As notícias abrem no navegador do celular.
- Tem a caixa **"Me avisar na véspera e no dia de cada data"**: notificação às 9h. Ela se reagenda sozinha quando o calendário muda.
- Quando sai versão nova (`gasolina apk-nova`), o app mostra "Saiu a versão X — Baixar e instalar". A lista vem de `site/app-versao.json`.

**Assinatura:** o APK é assinado com a chave de teste do PC (`~/.android/debug.keystore`), a mesma do Prumo.
Versão nova só instala por cima se vier deste mesmo PC. Há uma cópia em `~/Documentos/gasolina-prumo-chave-android-debug.keystore`; sem ela,
quem já tem o app vai precisar desinstalar para instalar a nova.

**Arquivos:** `capacitor.config.json`, `package.json`, `android/` (projeto Android; a versão fica em
`android/versao.properties`), `copiar-www.sh` (site/ → www/), `montar-apk.sh`, `site/nativo.js` (o que só vale no celular),
`coletor-js/` (o coletor do celular: `coletor.mjs`, `pdf-texto.mjs`, `ambiente-node.mjs` para testar no PC),
`testes/coletor-js.mjs` (JS × Python), `testes/apk.js` (simula o Android com internet de verdade, partindo de um APK
"atrasado" uma semana, e depois sem internet). Rode os dois com `gasolina testar-celular`.

## Como as informações se atualizam todo dia

```
07:15 e 19:15  robô do GitHub ── baixa ANP, dólar, Brent, notícias ──> refaz a previsão ──> publica o site
07:45 e 19:45  relógio do PC ─── site atualizado há menos de 20 h? ──> só copia os dados para o Painel
                               └─ site parado há 20 h ou mais? ─────> o PC atualiza e envia (reserva)
```

- Antes de publicar, só o relógio do PC atualiza o app local.
- **A ANP publica uma vez por semana**, na sexta ou no sábado. Nos outros dias mudam o dólar, o petróleo, as notícias e a contagem do calendário.
- A previsão se recalcula a cada atualização: a tabela de chances aprende com as semanas novas.

## Problemas previstos e o que já foi feito para cada um

| Problema | Solução já implementada |
|---|---|
| O site da ANP muda o nome dos arquivos (já aconteceu: `sintese-precos-46-pdf`, `sinteseprecos16.pdf`…) | Os endereços nunca são montados: o app lê a página de listagem da ANP e acha os arquivos |
| A ANP muda o layout do PDF da Síntese (mudou 3 vezes desde 2024) | O leitor entende os 3 layouts, confere se a soma das partes bate com o preço e confere se cada valor está numa faixa normal. Se não bater, não grava, mantém o último dado bom e avisa "formato mudou" |
| Site do governo fora do ar ou lento | 4 tentativas com espera crescente; cada fonte é independente; o app usa o último dado bom e mostra o aviso no topo |
| Dólar ou petróleo sem resposta | Fontes de reserva: dólar BCB → Yahoo → FRED; Brent Ipeadata → FRED, mais o Yahoo para o dado mais recente (o Yahoo às vezes recusa pedidos, erro 429) |
| Os servidores do GitHub (nos EUA) bloqueados por algum site brasileiro | O relógio do PC percebe que o site ficou parado há 20 h ou mais e assume a atualização |
| PC desligado vários dias, semanas faltando | Ao voltar, o coletor percebe o buraco e baixa de novo a série histórica da ANP |
| Planilha de observação da ANP confundindo o leitor | O cabeçalho só é aceito quando as células são exatamente os nomes esperados |
| Arquivo de dados corrompido (queda de energia no meio da gravação) | Toda gravação é atômica, num `.tmp` trocado no fim. Se mesmo assim corromper, o arquivo é renomeado para `.corrompido` e refeito |
| Duas atualizações ao mesmo tempo (relógio + manual) | Trava de arquivo: a segunda sai sem mexer em nada |
| O calendário fica velho (ex.: a data passou e ninguém atualizou) | Evento "Pode mudar" com data vencida vira **"Conferir!"** e aparece nos avisos. Manchete nova com as palavras do evento ("prorroga" + "desonera") gera o alerta "saiu notícia que pode mudar este evento". Notícias anteriores ao `revisado_em` são ignoradas |
| A previsão parecer mais certa do que é | Chances medidas no histórico real, puxadas para o normal quando há poucos casos, e um **teste honesto semana a semana** mostrado na tela. As previsões também são gravadas "ao vivo" e conferidas depois |
| Celular sem internet | Modo offline: a tela e os últimos dados ficam guardados no aparelho |
| Navegador mostrando dado velho do cache | Os dados são pedidos com marca de tempo e a internet tem prioridade sobre o cache |
| Fonte falhando por dias sem ninguém notar | O PC mostra uma notificação se a mesma fonte falhar 4 vezes seguidas (2 dias). O GitHub manda e-mail se o robô falhar |
| O robô do GitHub desliga após 60 dias sem atividade | O próprio robô grava dados novos toda semana, o que conta como atividade. O relógio do PC é a reserva |
| Celular sem internet (APK) | Percebe em segundos e mantém os últimos dados guardados, com aviso (testado) |
| Fonte bloqueia o celular (CORS) ou pede "navegador de verdade" | O HTTP nativo do Android não sofre CORS e se identifica como navegador comum (a ANP recusa pedidos sem isso) |
| Atualização cortada no meio (app fechado, bateria) | Grava tudo de uma vez só no fim. Se for interrompida, nada muda e a próxima abertura tenta de novo |
| Coletor do celular diferente do PC | Teste automático `testes/coletor-js.mjs` compara os dois. Até a soma é feita do mesmo jeito do Python (`fsum`) |
| Android com navegador interno muito velho | Mensagem pedindo para atualizar o "Android System WebView" na Play Store |
| Celular sem espaço para guardar os dados | Descarta primeiro a lista de cidades, a parte maior, e mantém o resto |
| APK desatualizado | Aviso "Saiu a versão nova" dentro do app, com link para baixar |
| Abrir o `index.html` com dois cliques (não carrega) | A página explica que precisa abrir pelo Painel |

## Quanto a previsão acerta (medido em 22/11/2026)

O teste foi feito semana a semana nos últimos 12 meses, usando só o que se sabia em cada semana:

- Quando o app apontou chance maior de alta, o preço subiu em **31%** das vezes. Sem aviso, sobe em 23%.
- No geral, as chances do app erram **1,2% menos** do que usar só a média.

É uma melhora pequena e real. O preço na bomba anda em degraus, por decisões da Petrobras, do governo e
dos postos. Por isso o calendário (impostos com data) e as manchetes de anúncio da Petrobras e das
refinarias aparecem em destaque: são os sinais mais fortes. Tentei antes uma previsão de valor exato em reais,
e nenhuma versão bateu o simples "vai ficar igual". Por isso o app mostra chance, não valor exato.

## Arquivos

| Arquivo | O que é |
|---|---|
| `coletor/atualizar.py` | Programa que atualiza tudo (só Python padrão + `pdftotext`) |
| `coletor/anp.py`, `mercado.py`, `noticias.py` | Leitura de cada fonte |
| `coletor/previsao.py` | A conta do repasse e a tabela de chances |
| `eventos.json` | **Calendário** de impostos e datas (editável) e lista de Estados com refinaria privada |
| `dados/` | Memória do sistema: tudo o que já foi coletado desde 2013 |
| `site/` | O app (HTML/CSS/JS puro, sem bibliotecas). `site/dados/` é o que a tela lê |
| `.github/workflows/atualizar.yml` | O robô do GitHub |
| `gasolina.sh` | O comando `gasolina` (link em `~/.local/bin/gasolina`) |
| `testes/tela.js` | Teste num navegador de verdade (usa o Playwright instalado no Prumo) |
| `~/.config/systemd/user/gasolina-atualizar.timer` | Relógio do PC (07:45 e 19:45) |

Primeira carga do zero: `python3 -I coletor/atualizar.py --reconstruir` (cerca de 5 minutos, baixa ~40 MB).

## Visual em abas (EM TESTE desde 22/11/2026)

A tela foi reorganizada em 5 abas (no celular, a barra fica embaixo):
**Resumo** (preço, previsão, motivos em linguagem simples, próximas datas) · **Por quê** (do que é feito o
preço, o que mudou nos custos, importação, petróleo/dólar/etanol, um gráfico por vez) · **Estados** (mapa,
ranking, cidades do Estado) · **Agenda** (calendário + notícias com filtro) · **Sobre** (método, acerto,
fontes, tema claro/escuro).

- Visual antigo guardado em `.antes-visual-20261122/` (site/, testes e gasolina.sh). Para desfazer:
  `cp .antes-visual-20261122/{index.html,app.js,estilo.css} site/`.
- APK de teste: `~/Downloads/Gasolina-teste.apk` (versão 1.2). Publicar o teste no GitHub sem mexer na
  estável: `gasolina apk-teste "o que mudou"` (pré-lançamento; ninguém é avisado; o link fixo continua na 1.1).
  Instalar a 1.2 de teste por cima da 1.1 mantém os dados.
- Quando aprovado: `gasolina publicar` não é preciso de novo; rode `gasolina apk-nova "Visual novo em abas"`
  (vira a 1.2 estável; quem tem o teste instala por cima sem perder nada).
- Testes: `node testes/tela.js` passa pelas 5 abas em 4 tamanhos de tela (PC, celular claro/escuro, celular
  pequeno) e acusa qualquer coisa que passe da borda do cartão.
- 22/11 (2ª rodada, a pedido dele):
  - Botão **"Entenda"** em 14 blocos. Abre uma explicação curta e sem termos econômicos. Os textos ficam no `EXPLICA` do app.js.
  - Glossário "Palavras que aparecem no app" na aba Sobre (`GLOSSARIO`).
  - **×** nos atalhos de lugar do topo, para tirar uma cidade ou Estado. O Brasil fica sempre.
  - Rótulos técnicos trocados: gasolina A → "gasolina pura", PPI → "gasolina importada", "falta repassar" → "falta chegar à bomba".
  - Backup desta rodada em `.antes-entenda-20261122/`.

## Preço posto a posto — aba **Postos** (EM TESTE desde 23/11/2026)

Pedido dele: ver os postos da cidade e quanto cada um cobra pela gasolina, pelo etanol e pelo diesel.
Fonte: **dados abertos da ANP**, planilhas "últimas 4 semanas" do Levantamento de Preços
(`…/dados-abertos/arquivos/shpc/qus/ultimas-4-semanas-gasolina-etanol.csv` e `…-diesel-gnv.csv`).
Cada linha é um posto visitado, um combustível, a data da visita e o preço. São ~5.900 postos em 417 cidades
(as mesmas do app), e a ANP atualiza uma vez por semana.

- **Na tela:** aba **Postos** (6ª aba) com os combustíveis Gasolina, Etanol, Diesel S10 e Diesel comum.
  - Postos do mais barato para o mais caro, com "visto em dd/mm", bandeira, endereço e os outros combustíveis.
  - Botão "📍 Como chegar", que abre o Google Maps.
  - Diferença num tanque de 50 L e "etanol ou gasolina" pela regra dos 70%.
  - ~~No Resumo, cartão "Gasolina mais barata em <cidade>"~~ RETIRADO em 23/11 a pedido dele ("devem conter apenas na aba dos postos"). Backup em `site/*.bak-20261123-tirar-cartao-resumo`.
  - Com Estado escolhido, a aba mostra as cidades dele para tocar.
  - Tem "Entenda" e 4 palavras novas no glossário.
- **No PC:** `coletor/postos.py` roda junto com a atualização das 07:45 e 19:45. Antes, pergunta à ANP o tamanho
  das planilhas, baixando só 1 byte: a ANP **recusa HEAD**, então ele usa `Range: bytes=0-0` e lê o total no `Content-Range`.
  Só baixa os ~12 MB quando a ANP publicou planilha nova. Grava `site/dados/postos/<UF>.json`, **sempre os 27**:
  o Painel trava se a página pedir arquivo que não existe. Para forçar: `python3 -I coletor/postos.py --forcar`.
- **No celular (APK):** o próprio aparelho confere o tamanho na ANP, no máximo a cada 6 h e só ao abrir uma cidade.
  Se mudou, tenta primeiro o arquivo pequeno do Estado no GitHub (`raw.githubusercontent.com/…/site/dados/postos/UF.json`,
  ~50 KB). Se o GitHub estiver atrasado, baixa a planilha inteira da ANP (~12 MB, uma vez por semana) e monta tudo
  no aparelho. Funciona sem o PC.
- **Regra dupla:** a conta existe em Python (`coletor/postos.py`) e em JS (`coletor-js/postos.mjs`).
  `node testes/postos.mjs` compara os dois. Em 23/11/2026 os 27 Estados deram idênticos. O teste também roda no `apk-nova`.
- **Testes:** `node testes/tela.js` passa pelas 6 abas e confere Petrolina (ordem, regra dos 70%, troca de combustível, link do mapa).
  `testes/apk.js` simula um APK com preços velhos e confere que o "celular" baixou da ANP sozinho e não baixou de novo sem precisar.
- **Não testado:** aparelho de verdade. Falta confirmar se o "Como chegar" abre o app Maps ou o navegador.
- Backup de antes desta mudança: `.antes-postos-20261123/`.

### Mini mapa dos postos (23/11/2026, EM TESTE) — a partir de uma tela do Dribbble que ele mandou

- **Na aba Postos:** mapa da cidade com uma etiqueta de preço por posto.
  - O mais barato fica em verde. Etiqueta tracejada quer dizer "local aproximado".
  - Busca pelo nome do posto e botão de **seta**: "perto de mim", que usa o GPS só quando ele toca e não guarda nada.
  - Cartões deslizando para o lado, sincronizados com o mapa: tocar numa etiqueta acende o cartão, e deslizar o cartão acende a etiqueta.
  - Embaixo, "Todos os postos" com a escolha **Mais barato** (padrão) ou **Mais perto**.
- **Ficou de fora, por decisão dele:** fotos dos postos e estrelas de avaliação (não há fonte gratuita) e tempo de viagem (achou desnecessário).
  - "Como chegar" abre a rota no Google Maps com o ponto exato.
- **Mapa:** MapLibre GL 5 (`site/lib/maplibre-gl.js`, 1 MB, carregado só quando a aba Postos abre) + **OpenFreeMap**
  (`tiles.openfreemap.org/styles/positron` e `/dark`). É gratuito, sem chave e sem limite. Sem internet não há mapa, mas a lista funciona.
- **Onde fica cada posto:** `coletor/locais.py`, só no PC. Usa o OpenStreetMap:
  - Overpass traz os postos desenhados na cidade.
  - Se o nome bate, o local é aquele.
  - Senão, o Nominatim acha o endereço, com abreviações expandidas, e o ponto "encosta" no posto desenhado mais próximo.
  - Se nada disso der certo, usa o bairro e marca como aproximado.
  - Tudo respeita 1 pedido por segundo e fica guardado em `dados/postos_locais.json` (cada posto é procurado uma vez; os que falham são tentados de novo após 30 dias).
  - Gera `site/dados/locais/<UF>.json`, sempre os 27.
  - Roda na atualização das 07:45 e 19:45 (no máximo 15 min por rodada, só postos novos), com trava contra rodar duas vezes ao mesmo tempo.
  - Primeira carga do país: `systemd-run --user --unit=gasolina-locais … python3 -I coletor/locais.py` (~7 h, iniciada em 23/11 às 22h). Andamento: `journalctl --user -u gasolina-locais -f`.
  - Pernambuco: 190 de 209 postos no mapa (91%); 109 exatamente sobre o posto desenhado.
- **No celular:** os locais vêm dentro do APK e são atualizados pelo GitHub (`raw…/site/dados/locais/UF.json`) a cada 6 h. O celular não procura endereços.
  Posto novo que o celular baixou direto da ANP aparece só na lista até o PC achar o local dele.
- **Permissão de localização** no `android/app/src/main/AndroidManifest.xml` (aproximada e exata).
- **Testes:** `testes/tela.js` confere etiquetas, toque na etiqueta → cartão, "perto de mim" (com GPS simulado no centro de Petrolina) e a busca por nome.
- Backup de antes do mapa: `.antes-mapa-20261123/`.

## Atualização automática do app (como o Prumo) — desde 23/11/2026

O app Android tem duas partes:
- **Miolo** (telas, cores, regras: HTML/CSS/JS). Troca **sozinho**, sem aviso: `site/miolo.js` + `@capgo/capacitor-updater` em modo manual, sem a nuvem da Capgo.
  - Ao abrir (no máximo a cada 30 min), o app pergunta ao GitHub as releases.
  - Se houver um `miolo.zip` mais novo que sirva para o APK instalado, baixa e troca quando o app vai para o fundo.
  - Se o miolo novo não abrir em 10 s, volta sozinho ao anterior. Os dados (IndexedDB/localStorage) não são tocados.
- **Parte nativa** (APK: permissões, código Android, plugins). Quando muda, a release leva `[nativo:N]` maior que o APK instalado,
  e o app mostra no Resumo a faixa **"Versão nova"** com o botão **Atualizar**.
  - O botão chama `GasolinaPlugin.java`, que baixa o APK, só do `github.com/pimentel-code/gasolina/releases/download/`, e abre o instalador.
  - Na primeira vez, o Android pede "Permitir desta fonte".
- **Canais:** `gasolina apk-teste "o que mudou"` publica uma pré-release `v1.N` (APK + miolo.zip). Só a recebe quem ligou
  **"Receber versões de teste"** na aba Sobre. `gasolina aprovar` libera para todos (vira a "latest", e o link fixo e o QR passam a dar essa versão).
  `gasolina apk-nova "…"` faz as duas coisas de uma vez.
- O script decide sozinho se a parte nativa mudou, comparando `android/`, `capacitor.config.json` e `package*.json` com a última tag `v1.N`
  (inclui arquivos novos ainda não guardados). O número nunca se repete: a v1.2-teste antiga conta.
- Site (quando o robô for ligado): o robô publica as telas do ramo **`estavel`** (a versão aprovada) com os dados mais novos do `main`. Assim a versão de teste não vaza para o site.
- **Testes:** `node testes/miolo.js` cobre 5 situações de escolha de versão. `testes/apk.js` simula um GitHub com 1.8 (só telas) e 1.9 (APK novo).
- **A 1ª versão com isso** precisa ser instalada **à mão** (QR), porque os APKs antigos não têm a peça. Depois, nunca mais.
- Backup de antes: `.antes-autoatualizar-20261123/`.

## Nome "Gas" e página de convite (23/11/2026)
- O nome visível passou a ser **Gas** (tela, ícone no celular, Painel). Pasta, repositório, comando `gasolina` e o arquivo `Gasolina.apk` continuam com o nome antigo de propósito: trocar quebraria o link fixo e a atualização de quem já instalou. Backup: `.antes-nome-gas-20261123/`.
- Convite: `site/instalar.html` (passo a passo Android/iPhone; no PC mostra QR). Link: https://pimentel-code.github.io/gasolina/instalar.html — `gasolina convite` mostra link + QR (`site/icones/convite-qr.png`). Só fica no ar com o site ligado (`gasolina ligar-robo`) e depois de aprovar uma versão que tenha a página (o site sai do ramo `estavel`).
