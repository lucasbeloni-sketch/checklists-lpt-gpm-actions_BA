# checklists-lpt-gpm-actions_BA

Robô headless (GitHub Actions) que baixa o relatório **Checklists
Pergunta/Resposta** do GPM **BA** (`https://sirtecba.gpm.srv.br/`) filtrado em
`Tipo de Checklist = LPT - Visita Prévia-BA`, extrai o CSV do `.zip` e sobrescreve
`mm.aaaa.csv` na pasta do Drive
`PCP > Time CCM - BA > Controle > Arquivos > Checklists_LPT`
(ID `1Wk6-OlJUV9u7ZVtRkAmat5gyJySkz9zN`).

Gêmeo do [`checklists-visita-previa-gpm-actions_BA`](https://github.com/lucasbeloni-sketch/checklists-visita-previa-gpm-actions_BA),
que faz o mesmo na mesma tela para o tipo `UTD - Visita Prévia-BA`. **A única
diferença funcional entre os dois é o tipo de checklist e a pasta de destino** —
todo o resto (calibração da tela, tratamento das datas, guardas, backfill) veio
calibrado de lá. As armadilhas da tela estão documentadas no `config.json`, campo
por campo; leia antes de mexer nos seletores.

Upload direto pela Drive API com service account: sem Google Drive Desktop
montado, sem ponte com o desktop.

## O que o robô faz por execução

1. Login no GPM BA (`#idLogin`/`#idSenha`).
2. Abre Segurança > Checklists > Exportações > Checklists Pergunta/Resposta
   (chamando `abrirTela()` do shell, como os links do menu — `goto` direto na URL
   não é repetível).
3. Calcula o período **ancorado em ontem (D-1)**:
   - Início = 1º dia do **mês de ontem**
   - Fim = ontem
   - Os **4** campos recebem esse mesmo par (Data Serviço Início/Fim + Data
     Inspeção Início/Fim).
4. Seleciona `Finalidade = 10 - Vistoria de Obras Elétricas` e
   `Tipo de Checklist = LPT - Visita Prévia-BA`.
5. **Relê os 4 campos de data** antes de exportar — se algum não bateu, falha em
   vez de exportar o período errado.
6. Clica **Exportar** e captura o download.
7. Extrai o CSV do zip, valida linhas + coluna `Data Execução`, padroniza no
   `layout.json` (quando já houver layout) e sobrescreve `mm.aaaa.csv` no Drive
   (com auto-dedup de duplicatas de mesmo nome).

Virada de mês é automática: no dia 1, ontem pertence ao mês anterior, então a
rodada fecha o mês anterior completo. Nenhuma lógica extra.

Mês/período **sem registros** (toast laranja "Nenhum registro encontrado") é
condição normal: o run termina **OK** sem tocar no Drive, e carimba o timestamp
com sufixo `(sem registros)`.

## Secrets necessários

| Secret | Pra quê |
|---|---|
| `GOOGLE_CREDENTIALS` | JSON da service account (precisa ser **Editor** na pasta destino e na planilha de controle) |
| `GPM_BA_USER` / `GPM_BA_PASS` | Login do GPM BA |
| `GPM_USER` / `GPM_PASS` | Fallback, usado só se os `GPM_BA_*` não existirem |

O login do BA é o mesmo usuário do dia a dia (`SIR795027`) — confirmado no repo
gêmeo. O fallback `GPM_USER`/`GPM_PASS` existe só para o caso de os secrets `BA`
não estarem criados.

## Agenda

`.github/workflows/baixar.yml`: cron a cada 6h (UTC) + botão manual
(`workflow_dispatch`, com checkbox `dry_run`). `concurrency` impede dois runs
escrevendo o mesmo arquivo do mês.

## Tela do GPM — calibrado em 2026-08-10 (no repo gêmeo, mesma tela)

| Item | Valor real |
|---|---|
| Rota | `/ci/Seguranca/ChecklistPerguntaResposta` (código de tela `GR669`) |
| Onde vive | dentro do iframe `#frameTelasGPM` |
| Datas | **flatpickr com `altInput`**: o input visível não tem id; o form submete os hidden `#data_inicial`, `#data_final`, `#data_insp_in`, `#data_insp_out` em `Y-m-d H:i` |
| Finalidade | `<select id="finalidade">` escondido atrás de widget **Choices.js** |
| Tipo de Checklist | `<select id="tipos">`, também Choices.js, **populado por AJAX só depois** de escolher a Finalidade |
| Exportar | `button.btn-success` sem id → casado por classe + texto |

Duas consequências que mudaram o código:

**1. Horas são parte do filtro.** Os 4 campos têm `enableTime: true`. Os
`data-options` do próprio GPM usam `defaultHour` `00:00` nos campos de início
(classe `dta-zero`) e `23:59` nos de fim (`dta-fim`). O robô seta esses horários
explicitamente — um fim às `00:00` cortaria o último dia inteiro do intervalo.
Foi exatamente esse o bug silencioso da Skill manual no repo gêmeo: o último dia
de cada mês fechado ficava fora do export.

**2. Nada de `<select>` nativo.** Choices.js tira as opções do select e as
mantém em DOM próprio, com filtro fuzzy na busca. O robô abre o widget, digita
um **token curto** (`finalidadeSearch` / `tipoChecklistSearch` no config —
digitar a string inteira não casa), **clica no item de texto exatamente igual ao
alvo** (nunca Enter, que pega o primeiro filtrado) e confere pelo select nativo,
que é o que o submit usa.

O token deste repo é `LPT - Visita`. Ele é discriminante: o único outro tipo com
`LPT` é `Validação- Clientes - LPT`, que não contém `LPT - Visita`. Ainda assim o
clique é por texto exato — token discriminante é conveniência, a garantia é o
texto exato + conferência no `<select>`.

Se o GPM renomear as opções, ajuste os tokens no `config.json` e rode o
`inspect` de novo.

### Recalibrar / validar

```bash
npm install
npx playwright install chromium

# Abre o browser visível, você faz o login, e ele redespeja os candidatos:
HEADED=1 npm run inspect

# Confere se a service account alcança a pasta do Drive:
GOOGLE_CREDENTIALS="$(cat credentials.json)" npm run check

# Ensaio completo sem escrever no Drive:
GPM_BA_USER=... GPM_BA_PASS=... DRY_RUN=1 npm start
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | rotina completa (D-1 → Drive) |
| `DRY_RUN=1 npm start` | baixa e valida, não envia ao Drive |
| `HEADED=1 npm start` | browser visível (debug local; permite login manual) |
| `npm test` | testes unitários (datas, parse, DOM stub da tela) |
| `npm run inspect` | calibra seletores da tela |
| `npm run check` | valida acesso ao Drive e lista a pasta |
| `npm run carimbar` | grava só o timestamp na planilha de controle (valida acesso ao Sheets) |
| `npm run meses` | imprime a lista de dias da **carga inicial** (último dia de cada mês) |
| `npm run gerar-layout` | monta o `layout.json` a partir dos CSVs que já estão na pasta |

## Timestamp de última execução

No **fim** de todo run bem-sucedido (inclusive mês sem registros, marcado
`(sem registros)`), o robô carimba data/hora BRT em `BD_Config!C10` da planilha
`1-_lTKT4wSDlJtTXkF1tLHstV9h-S3Yq_2cE8jOIC3kI` — quem olha a planilha vê quando
a rotina rodou por último sem abrir o GitHub Actions. `B10` traz o nome do robô;
o `C8` da linha de cima é do gêmeo UTD, não mexa nele.

- Configurável em `config.json` → `timestamp` (`spreadsheetId`, `aba`, `celula`).
- `DRY_RUN=1` e runs que falharam **não** carimbam.
- Escopo `spreadsheets` (não é o do Drive): a service account precisa de acesso
  **Editor** na planilha. Sem acesso, o run diário só emite warning
  `[timestamp] NAO consegui gravar` — não falha, porque o CSV já foi enviado.
- Workflow manual **Carimbar timestamp** roda só esse passo, pra testar acesso.

## Guardas contra sobrescrever o mês com lixo

- CSV com menos de `minLinhasDados` (1) linha de dados → aborta, não envia.
- Alguma `Data Execução` fora do mês do arquivo → aborta (`AVISO_INTERVALO`),
  sinal de filtro de data errado.
- Divergência entre os 4 campos de data e o esperado → aborta antes de exportar.
- Download que veio HTML (sessão expirada) ou XLSX (botão errado) → erro claro.
- Padronização que perderia célula preenchida → aborta antes de subir.

Em qualquer falha, screenshot + HTML da tela sobem como artefato `debug` do run
e uma issue rolante é aberta/comentada.

## Layout da base (layout.json)

A pasta é carregada por uma plataforma, então **todo arquivo tem que ter o mesmo
cabeçalho**. O alvo fica em `layout.json`, versionado no repo:

| | |
|---|---|
| colunas canônicas | o que o GPM exporta hoje, na ordem dele |
| colunas do fim | perguntas **aposentadas** do formulário, que só aparecem nos arquivos antigos |

Isso é necessário porque **o export do GPM não tem schema fixo**: ele traz uma
coluna por PERGUNTA, e só as perguntas presentes nos registros filtrados. No repo
gêmeo, exportando um dia de cada mês de 2023–2025, o número de colunas variou
entre 67 e 78 — e dois dias com 67 colunas tinham conjuntos de perguntas
*diferentes*. Não existe schema estável nem dentro do mesmo ano.

O layout é superconjunto de todos os arquivos, então padronizar nunca descarta
resposta — e `src/padronizar.js` **prova** isso a cada arquivo: compara as
células preenchidas coluna a coluna, antes e depois, e aborta em qualquer
diferença.

**Se o GPM ganhar pergunta nova**, ela é anexada no fim e o run avisa
(`ATENCAO: coluna(s) nova(s)`). Nada é descartado em silêncio; aí regenere o
layout pra pasta voltar a ser homogênea.

### `layout.json` nasce VAZIO neste repo — de propósito

O formulário LPT tem outras perguntas que o UTD, então o layout do gêmeo não
serve. E não há como saber o layout completo antes de ter a base: um único export
só revela as perguntas daquele período.

Enquanto `layout.colunas` estiver vazio, o robô diário e o backfill sobem o
**export como veio** e avisam no log. A ordem correta é:

1. **carga inicial** (abaixo) enche a pasta com um `mm.aaaa.csv` por mês;
2. `npm run gerar-layout` (ou o workflow **Gerar layout.json**) monta o layout
   pela união das colunas: canônicas = cabeçalho do mensal mais recente,
   aposentadas = as que só existem nos arquivos antigos **e têm resposta**;
3. confira o diff e commite;
4. `npm run padronizar` conforma os arquivos que já estão na pasta.

`npm run padronizar` recusa rodar com layout vazio — sem alvo não há o que
padronizar.

## Carga inicial da base

A pasta nasce vazia, então `npm run faltantes` não acha buraco nenhum (ele
compara com o que já existe). A carga é **um export por mês**, via workflow
**Backfill dias perdidos**:

```bash
npm run meses                          # 01/2023 até o mês passado (43 meses hoje)
DE=2023-01 ATE=2023-12 npm run meses   # um lote
```

Cole a saída no input `dias` do workflow. **Cada item é o último dia do mês**, e
não é detalhe: na estratégia de mês inteiro o backfill exporta de `01/mm` até o
dia que você passar — `15/03/2023` traria só a primeira metade de março.

Vá em **lotes de ~12 meses**: cada mês é um export no GPM e o run tem timeout de
120 min. Rode o primeiro lote com `dry_run` marcado.

O resultado é um arquivo por mês (`mm.aaaa.csv`) em todos os anos. Consolidar os
meses de um ano fechado num único `aaaa.csv` é decisão manual, como no gêmeo —
`npm run auditar` e `npm run analisar` ajudam a conferir antes.

Meses sem nenhuma LPT saem como `vazio` no manifesto, sem erro.

### Ferramentas de base

| Comando | O que faz |
|---|---|
| `npm run faltantes` | lista dias provavelmente faltando (só lê o Drive) |
| `npm run auditar` | confere alinhamento estrutural de todos os CSVs (só lê o Drive) |
| `npm run analisar` | mostra o custo de conformar ao layout: perguntas fora e respostas em jogo |
| `npm run padronizar` | reprojeta a pasta no layout (aceita `DRY_RUN=1`) |
| `npm run conferir` | reexporta um mês do GPM e compara célula a célula com o arquivo da pasta |
| `npm run diag` | exporta várias combinações de filtro e loga payload/resposta (`LOG_REDE=1`) |

## Backfill de dias faltando

Depois da carga inicial, o backfill serve para buracos pontuais:

```bash
GOOGLE_CREDENTIALS="$(cat credentials.json)" npm run faltantes   # escopo, só lê o Drive

DRY_RUN=1 npm run backfill              # exporta e mostra o que mudaria, sem gravar
npm run backfill                        # grava
DIAS="31/07/2026" npm run backfill      # só um dia
```

Três estratégias, escolhidas pelo nome do arquivo de destino:

| Modo | Estratégia | Quando |
|---|---|---|
| destino `mm.aaaa.csv` | reexporta o **mês inteiro** (01/mm até o dia passado) e substitui | arquivo = 1 mês; é também o modo da carga inicial |
| destino `aaaa.csv` | exporta **só o dia** e mescla, com guarda de cabeçalho | só se existir arquivo anual consolidado |
| `SAIDA=<nome.csv>` | exporta cada dia e junta num arquivo **novo**, por união de colunas | quando os cabeçalhos divergem e não há encaixe correto no destino |

Guardas do merge (`src/merge.js`):

- **Cabeçalho tem que ser idêntico.** Se o export de hoje vier com colunas
  diferentes do arquivo de destino, aborta aquele dia e registra no manifesto —
  nunca desalinha colunas.
- **Append textual**: as linhas do destino não são reserializadas, então campos
  com quebra de linha dentro de aspas saem byte a byte iguais.
- **Dedup por `cod_checklist`**: o export de um dia pode trazer linhas cuja
  `Data Execução` é de outro dia (o filtro é por Data Serviço / Data Inspeção),
  e essas podem já estar no destino.
- **Não mexe se o dia já existe** no destino.
- Na estratégia de mês inteiro, recusa substituir se o export vier com **menos**
  linhas que o arquivo atual.

Cada dia é um export no GPM; o script vai um a um e no fim imprime um manifesto
`dia;arquivo;status;linhas`.

O detector de buracos separa evidência **forte** (dia da semana comparável
costuma ter registro) de **fraca** (esse dia da semana normalmente tem ~0). Ele
lê só a coluna `Data Execução`, e o filtro do GPM é por Data Serviço/Inspeção —
então um dia pode continuar listado mesmo depois de recuperado, se as linhas
trazidas tiverem execução em outra data. Rodar o backfill nele de novo é
inofensivo (substitui pelo mesmo conteúdo).

## Estado

- Repo criado a partir do gêmeo UTD em 21/08/2026. `layout.json` vazio
  (bootstrap), pasta do Drive vazia, carga inicial pendente.
- Acesso da service account à pasta `Checklists_LPT` **validado**
  (`npm run check`).
- `BD_Config!B10` já traz o nome do robô; `C10` é carimbado no primeiro run OK.
- 82 testes unitários passando (`npm test`).
