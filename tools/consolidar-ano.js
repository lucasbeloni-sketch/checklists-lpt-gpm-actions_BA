// Consolida os mm.aaaa.csv de um ano FECHADO num unico aaaa.csv.
//
// Convencao da base (mesma do repo gemeo): ano fechado = 1 arquivo por ano, ano
// corrente = 1 arquivo por mes. O robo diario so escreve o mes corrente, entao
// consolidar um ano passado nao briga com ele.
//
// Por que isso e uma operacao de risco e como o codigo se protege:
//
//   - juntar arquivos e irreversivel na pratica se algo se perder no meio. Aqui
//     a juncao e por NOME de coluna (nunca posicao) e passa por um portao: a
//     contagem de celulas PREENCHIDAS por coluna do consolidado tem que bater
//     com a soma dos mensais. Qualquer diferenca aborta antes de subir nada.
//   - dedup por cod_checklist, para o caso de a mesma linha aparecer em dois
//     meses (o filtro do GPM e por Data Servico/Inspecao, nao por Data Execucao).
//   - se o aaaa.csv ja existir, ele entra na juncao como mais uma parte — nunca
//     e sobrescrito as cegas.
//   - os mensais so vao pra LIXEIRA depois do upload do anual dar certo, e
//     lixeira e reversivel (o Drive guarda 30 dias). Com MANTER_MENSAIS=1 nem
//     isso acontece.
//   - recusa consolidar o ano CORRENTE: o mes em andamento ainda vai receber
//     escrita do robo diario, e ele escreve em mm.aaaa.csv.
//
// Uso:
//   GOOGLE_CREDENTIALS=... DRY_RUN=1 npm run consolidar              ensaio
//   GOOGLE_CREDENTIALS=... npm run consolidar                        todos fechados
//   GOOGLE_CREDENTIALS=... ANOS=2023,2024 npm run consolidar         so esses
//   GOOGLE_CREDENTIALS=... MANTER_MENSAIS=1 npm run consolidar       nao mexe na lixeira

const cfg = require("../config.json");
const layout = require("../layout.json");
const { listarCsv, baixarCsv, uploadCsv, enviarParaLixeira } = require("../src/drive");
const { parseCsv, serializeCsv } = require("../src/uniao");
const { juntarNoLayout, preenchidasPorNome, reprojetar, validar } = require("../src/padronizar");
const { ontem } = require("../src/util");

const mensalDe = (nome) => {
  const m = /^(\d{2})\.(\d{4})\.csv$/i.exec(nome);
  return m ? { mes: m[1], ano: m[2] } : null;
};

// Soma, coluna a coluna (por nome), as celulas preenchidas de varias partes.
function somaPreenchidas(partes) {
  const total = new Map();
  for (const p of partes) {
    for (const [k, n] of preenchidasPorNome(p.header, p.rows)) {
      total.set(k, (total.get(k) || 0) + n);
    }
  }
  return total;
}

(async () => {
  if (!layout.colunas.length) {
    throw new Error('layout.json vazio. Rode "npm run gerar-layout" antes de consolidar.');
  }
  const dryRun = !!process.env.DRY_RUN;
  const manterMensais = !!process.env.MANTER_MENSAIS;
  const anoCorrente = String(ontem(cfg.timezone).ano);

  const arquivos = await listarCsv(cfg);
  const porAno = new Map();
  for (const f of arquivos) {
    const m = mensalDe(f.name);
    if (!m) continue;
    if (!porAno.has(m.ano)) porAno.set(m.ano, []);
    porAno.get(m.ano).push(f.name);
  }

  let anos = [...porAno.keys()].sort();
  if (process.env.ANOS) {
    const pedidos = process.env.ANOS.split(",").map((s) => s.trim());
    const semMensal = pedidos.filter((a) => !porAno.has(a));
    if (semMensal.length) throw new Error(`sem mm.aaaa.csv na pasta para: ${semMensal.join(", ")}`);
    anos = pedidos;
  }

  const corrente = anos.filter((a) => a === anoCorrente);
  if (corrente.length) {
    if (process.env.ANOS) {
      throw new Error(`${anoCorrente} e o ano CORRENTE — o robo diario ainda escreve em mm.${anoCorrente}.csv. Nao consolido.`);
    }
    console.log(`[consolidar] ${anoCorrente} e o ano corrente; fica mensal.`);
    anos = anos.filter((a) => a !== anoCorrente);
  }

  if (!anos.length) {
    console.log("[consolidar] nenhum ano fechado com mensais na pasta. Nada a fazer.");
    return;
  }
  console.log(`[consolidar] anos: ${anos.join(", ")} | dryRun=${dryRun} | manterMensais=${manterMensais}\n`);

  const resumo = [];
  for (const ano of anos) {
    const mensais = porAno.get(ano).sort();
    const anual = `${ano}.csv`;
    console.log(`########## ${ano}: ${mensais.length} mensal(is) -> ${anual} ##########`);

    // 1) Le as partes. Cada uma e reprojetada no layout — assim uma coluna que
    //    falte num mes nao desloca nada, e o portao de validacao continua valido.
    const partes = [];
    for (const nome of [...mensais, anual]) {
      const buf = await baixarCsv(nome, cfg);
      if (!buf) {
        if (nome === anual) continue;          // anual ainda nao existe: normal
        throw new Error(`${nome} sumiu da pasta no meio da leitura`);
      }
      const origem = parseCsv(buf);
      const destino = reprojetar(layout.colunas, origem);
      const v = validar(origem, destino);
      if (!v.ok) {
        throw new Error(`${nome} nao cabe no layout: ${v.problemas.slice(0, 3).join(" | ")}`);
      }
      if (destino.anexadas.length) {
        throw new Error(`${nome} tem coluna(s) fora do layout (${destino.anexadas.join(" | ")}). Rode "npm run gerar-layout" antes de consolidar.`);
      }
      partes.push({ nome, header: destino.header, rows: destino.rows });
      console.log(`[consolidar] ${nome}: ${destino.rows.length} linha(s)`);
    }

    // 2) Junta com dedup por cod_checklist.
    const junto = juntarNoLayout(layout.colunas, partes);
    const somaLinhas = partes.reduce((a, p) => a + p.rows.length, 0);
    console.log(`[consolidar] ${anual}: ${junto.rows.length} linha(s) (${somaLinhas} somadas, ${junto.dup} duplicada(s) descartada(s))`);

    // 3) PORTAO: celula preenchida por coluna tem que bater com a soma das
    //    partes, descontando o que saiu no dedup. Se nao bater, algo se perdeu.
    const antes = somaPreenchidas(partes);
    const depois = preenchidasPorNome(junto.header, junto.rows);
    const problemas = [];
    if (junto.rows.length !== somaLinhas - junto.dup) {
      problemas.push(`linhas: ${junto.rows.length} != ${somaLinhas} - ${junto.dup}`);
    }
    if (!junto.dup) {
      // Sem dedup a conta e exata; com dedup so da pra exigir que nao AUMENTE.
      for (const [k, n] of antes) {
        const m = depois.get(k) || 0;
        if (m !== n) problemas.push(`coluna "${k.slice(0, 50)}": ${n} preenchida(s) nas partes, ${m} no consolidado`);
      }
    } else {
      for (const [k, m] of depois) {
        const n = antes.get(k) || 0;
        if (m > n) problemas.push(`coluna "${k.slice(0, 50)}": consolidado tem MAIS preenchidas (${m}) que as partes (${n})`);
      }
    }
    if (problemas.length) {
      for (const p of problemas.slice(0, 10)) console.error(`   ${p}`);
      throw new Error(`consolidacao de ${ano} nao preservou os dados; NADA foi gravado`);
    }
    console.log(`[consolidar] portao OK: nenhuma celula preenchida perdida.`);

    if (dryRun) {
      console.log(`[consolidar] DRY_RUN: ${anual} ficaria com ${junto.rows.length} linhas x ${junto.header.length} colunas; ${mensais.length} mensal(is) iriam pra lixeira.\n`);
      resumo.push({ ano, anual, linhas: junto.rows.length, mensais: mensais.length, acao: "dry-run" });
      continue;
    }

    // 4) Sobe o anual PRIMEIRO. So depois mexe nos mensais.
    const buffer = Buffer.from(serializeCsv(junto.header, junto.rows), "utf8");
    const up = await uploadCsv(buffer, anual, cfg);

    let removidos = 0;
    if (manterMensais) {
      console.log(`[consolidar] MANTER_MENSAIS=1: os ${mensais.length} mensais de ${ano} ficam onde estao.`);
    } else {
      for (const nome of mensais) {
        const r = await enviarParaLixeira(nome, cfg);
        removidos += r.removidos;
      }
      console.log(`[consolidar] ${removidos} mensal(is) de ${ano} na lixeira (reversivel por 30 dias).`);
    }
    console.log(`[consolidar] ${anual} ${up.acao}: ${junto.rows.length} linhas.\n`);
    resumo.push({ ano, anual, linhas: junto.rows.length, mensais: removidos, acao: up.acao });
  }

  console.log("=== Resumo ===");
  console.log("ano;arquivo;linhas;mensais_removidos;acao");
  for (const r of resumo) console.log(`${r.ano};${r.anual};${r.linhas};${r.mensais};${r.acao}`);
})().catch((e) => {
  console.error(`[consolidar] ERRO: ${e.message}`);
  process.exit(1);
});
