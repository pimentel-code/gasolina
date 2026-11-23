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
