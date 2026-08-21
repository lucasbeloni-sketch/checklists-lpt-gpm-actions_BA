const test = require("node:test");
const assert = require("node:assert");
const { meses, ultimoDia, parseAnoMes } = require("../tools/meses-bootstrap");

test("ultimoDia acerta meses de 30, 31, fevereiro e ano bissexto", () => {
  assert.strictEqual(ultimoDia(2023, 1), 31);
  assert.strictEqual(ultimoDia(2023, 4), 30);
  assert.strictEqual(ultimoDia(2023, 2), 28);
  assert.strictEqual(ultimoDia(2024, 2), 29, "2024 e bissexto");
  assert.strictEqual(ultimoDia(2100, 2), 28, "2100 nao e bissexto");
  assert.strictEqual(ultimoDia(2026, 12), 31);
});

test("meses lista o ULTIMO dia de cada mes — nao o primeiro", () => {
  // Critico: na estrategia de mes inteiro o backfill exporta de 01/mm ate o dia
  // passado. Um dia no meio do mes traria so parte do mes.
  const r = meses({ ano: 2024, mes: 1 }, { ano: 2024, mes: 3 });
  assert.deepStrictEqual(r, ["31/01/2024", "29/02/2024", "31/03/2024"]);
});

test("meses atravessa a virada de ano", () => {
  const r = meses({ ano: 2023, mes: 11 }, { ano: 2024, mes: 2 });
  assert.deepStrictEqual(r, ["30/11/2023", "31/12/2023", "31/01/2024", "29/02/2024"]);
});

test("meses de um unico mes devolve um item; intervalo invertido devolve vazio", () => {
  assert.deepStrictEqual(meses({ ano: 2026, mes: 8 }, { ano: 2026, mes: 8 }), ["31/08/2026"]);
  assert.deepStrictEqual(meses({ ano: 2026, mes: 8 }, { ano: 2026, mes: 7 }), []);
});

test("parseAnoMes aceita aaaa-mm e recusa o resto", () => {
  assert.deepStrictEqual(parseAnoMes("2025-07", "DE"), { ano: 2025, mes: 7 });
  assert.throws(() => parseAnoMes("07/2025", "DE"), /DE invalido/);
  assert.throws(() => parseAnoMes("2025-13", "DE"), /mes 13/);
});
