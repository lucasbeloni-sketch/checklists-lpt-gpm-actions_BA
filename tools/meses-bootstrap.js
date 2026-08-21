// Monta a lista DIAS pra carga inicial da base (backfill mes a mes).
//
// Por que existe: a pasta nasce VAZIA, entao `npm run faltantes` nao tem como
// descobrir buraco nenhum — ele compara com o que ja existe. A carga inicial e
// um export por MES, e o backfill escolhe a estrategia "mes inteiro (replace)"
// quando o destino e mm.aaaa.csv (que e o caso quando o arquivo nao existe).
//
// ATENCAO ao formato: na estrategia de mes inteiro o backfill exporta de
// 01/mm/aaaa ATE O DIA QUE VOCE PASSAR. Por isso a lista tem que ser o ULTIMO
// dia de cada mes — passar 15/03/2023 traria so a primeira metade de marco.
//
// Uso:
//   npm run meses                          01/2023 ate o mes passado
//   DE=2025-01 ATE=2025-12 npm run meses   recorte
//   npm run meses -- --linhas              um por linha (pra conferir)
//
// A saida vai pro input "dias" do workflow Backfill. Va em lotes (uns 12 meses
// por run): cada mes e um export no GPM e o run tem timeout.

const { ontem } = require("../src/util");
const cfg = require("../config.json");

const p2 = (n) => String(n).padStart(2, "0");

// Ultimo dia do mes (dia 0 do mes seguinte, em UTC pra nao depender de fuso).
function ultimoDia(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

// Lista "dd/mm/aaaa" do ultimo dia de cada mes no intervalo [de, ate].
function meses(de, ate) {
  const out = [];
  let { ano, mes } = de;
  while (ano < ate.ano || (ano === ate.ano && mes <= ate.mes)) {
    out.push(`${p2(ultimoDia(ano, mes))}/${p2(mes)}/${ano}`);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  return out;
}

function parseAnoMes(s, rotulo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`${rotulo} invalido: "${s}" (use aaaa-mm)`);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) throw new Error(`${rotulo} invalido: mes ${mes}`);
  return { ano: Number(m[1]), mes };
}

if (require.main === module) {
  // Default: 01/2023 ate o MES PASSADO. O mes corrente e do robo diario, e o
  // ultimo dia dele ainda nao aconteceu.
  const hoje = ontem(cfg.timezone);
  const mesPassado = hoje.mes === 1 ? { ano: hoje.ano - 1, mes: 12 } : { ano: hoje.ano, mes: hoje.mes - 1 };

  const de = parseAnoMes(process.env.DE || "2023-01", "DE");
  const ate = process.env.ATE ? parseAnoMes(process.env.ATE, "ATE") : mesPassado;
  const lista = meses(de, ate);

  console.error(`[meses] ${lista.length} mes(es): ${p2(de.mes)}/${de.ano} ate ${p2(ate.mes)}/${ate.ano}`);
  console.error(`[meses] cada um e UM export no GPM — mande em lotes de ~12 pro run nao estourar o timeout.\n`);
  console.log(process.argv.includes("--linhas") ? lista.join("\n") : lista.join(","));
}

module.exports = { meses, ultimoDia, parseAnoMes };
