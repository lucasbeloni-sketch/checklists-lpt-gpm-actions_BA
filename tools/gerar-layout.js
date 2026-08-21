// Gera o layout.json canonico a partir dos CSVs que JA estao na pasta do Drive.
//
// Por que este tool existe: o export do GPM NAO tem schema fixo — traz uma
// coluna por PERGUNTA e so as perguntas presentes nos registros filtrados. Dois
// meses diferentes vem com conjuntos de colunas diferentes. Como a pasta e
// carregada por uma plataforma, todo arquivo tem que ter o MESMO cabecalho.
//
// Regra do layout (mesma do repo irmao UTD):
//   1. as colunas CANONICAS sao o cabecalho do mm.aaaa.csv MAIS RECENTE — e o
//      formulario como o GPM exporta hoje, na ordem que ele exporta;
//   2. as colunas que so aparecem em arquivos mais antigos (perguntas
//      APOSENTADAS do formulario) vao no FIM, na ordem em que foram achadas;
//   3. coluna que existe mas esta 100% vazia em todos os arquivos e IGNORADA
//      (nao vira coluna do layout) — nao ha resposta pra preservar.
//
// Uso:
//   GOOGLE_CREDENTIALS=... npm run gerar-layout            (grava layout.json)
//   GOOGLE_CREDENTIALS=... DRY_RUN=1 npm run gerar-layout  (so mostra)
//
// Depois de gerar: confira o diff, commite, e rode `npm run padronizar` pra
// conformar os arquivos que ja estao na pasta ao layout novo.

const fs = require("fs");
const path = require("path");
const cfg = require("../config.json");
const { listarCsv, baixarCsv } = require("../src/drive");
const { parseCsv } = require("../src/uniao");
const { indicePorNome, preenchidasPorNome, norm } = require("../src/padronizar");

const DESTINO = path.join(__dirname, "..", "layout.json");

// Nome de arquivo mensal "mm.aaaa.csv" -> chave ordenavel "aaaamm". Anuais
// ("2024.csv") nao entram: o canonico tem que ser o formulario ATUAL.
function chaveMensal(nome) {
  const m = /^(\d{2})\.(\d{4})\.csv$/i.exec(nome);
  return m ? `${m[2]}${m[1]}` : null;
}

(async () => {
  const dryRun = !!process.env.DRY_RUN;
  const arquivos = (await listarCsv(cfg)).sort((a, b) => a.name.localeCompare(b.name));
  if (!arquivos.length) {
    throw new Error("a pasta do Drive esta vazia — rode o robo (npm start) e/ou o backfill antes de gerar o layout");
  }

  const mensais = arquivos.filter((f) => chaveMensal(f.name)).sort((a, b) => chaveMensal(a.name).localeCompare(chaveMensal(b.name)));
  const canonico = mensais.length ? mensais[mensais.length - 1] : arquivos[arquivos.length - 1];
  if (!mensais.length) {
    console.warn(`[layout] nenhum mm.aaaa.csv na pasta; usando "${canonico.name}" como canonico (confira a ordem das colunas antes de commitar).`);
  }

  // Le todos os arquivos uma vez.
  const lidos = [];
  for (const f of arquivos) {
    const csv = parseCsv(await baixarCsv(f.name, cfg));
    lidos.push({ nome: f.name, csv, preenchidas: preenchidasPorNome(csv.header, csv.rows) });
    console.log(`[layout] ${f.name}: ${csv.rows.length} linhas, ${csv.header.length} colunas`);
  }

  const base = lidos.find((x) => x.nome === canonico.name);
  const colunas = [...base.csv.header];
  const vistas = new Set(indicePorNome(colunas).keys());

  // Extras dos outros arquivos, so as que TEM resposta em algum lugar.
  const extras = [];
  const semDado = [];
  for (const x of lidos) {
    if (x.nome === base.nome) continue;
    const idx = indicePorNome(x.csv.header);
    for (const [chave, i] of idx) {
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const n = x.preenchidas.get(chave) || 0;
      if (n === 0) { semDado.push(`${x.csv.header[i]} (${x.nome})`); continue; }
      extras.push({ nome: x.csv.header[i], origem: x.nome, respostas: n });
    }
  }

  console.log(`\n[layout] canonicas (de ${base.nome}): ${colunas.length}`);
  console.log(`[layout] aposentadas (so em arquivos antigos, com resposta): ${extras.length}`);
  for (const e of extras) console.log(`   + "${e.nome}" — ${e.respostas} resposta(s), visto em ${e.origem}`);
  if (semDado.length) {
    console.log(`[layout] ignoradas (coluna existe mas 100% vazia): ${semDado.length}`);
    for (const s of semDado.slice(0, 20)) console.log(`   - ${s}`);
  }

  const saida = {
    _comentario: `Layout canonico da base. As ${colunas.length} primeiras colunas sao o export atual do GPM (base: ${base.nome}); as ${extras.length} ultimas sao perguntas aposentadas do formulario, mantidas no fim pra nao perder as respostas historicas. Robo diario, backfill e padronizador usam este arquivo. Se o GPM ganhar pergunta nova, ela e ANEXADA no fim e o run avisa.`,
    geradoEm: new Date().toISOString().slice(0, 10),
    baseCanonica: base.nome,
    canonicas: colunas.length,
    aposentadas: extras.length,
    colunas: [...colunas, ...extras.map((e) => e.nome)],
  };

  // Nome repetido quebraria a reprojecao por nome — aborta antes de gravar.
  const repetidos = saida.colunas.filter((c, i) => saida.colunas.findIndex((o) => norm(o) === norm(c)) !== i);
  if (repetidos.length) {
    throw new Error(`layout teria coluna repetida: ${[...new Set(repetidos)].join(" | ")}`);
  }

  console.log(`\n[layout] total: ${saida.colunas.length} colunas`);
  if (dryRun) {
    console.log("[layout] DRY_RUN: layout.json NAO gravado.");
    return;
  }
  fs.writeFileSync(DESTINO, JSON.stringify(saida, null, 2) + "\n", "utf8");
  console.log(`[layout] gravado em ${DESTINO}. Confira o diff, commite, e rode "npm run padronizar" pra conformar a pasta.`);
})().catch((e) => {
  console.error(`[layout] ERRO: ${e.message}`);
  process.exit(1);
});
