/*!
 * fecrt.test.mjs — гейт витрины «ФЭКРТ»: известные ответы.
 *
 * Классы проверок (наследие гейт-культуры экосистемы):
 *  1. разбор ввода — RU-запятая и компания (урок Task 178 из ветвойса);
 *  2. точечные формулы — арифметика, сверенная руками;
 *  3. бутстрэп — детерминированность (один ввод = один ДИ) и ЗОЛОТО:
 *     интервалы, замороженные при авторстве; дрейф математики = красный CI;
 *  4. пороги — THRESHOLDS из fecrt.js против референса
 *     tests/thresholds.reference.json (паттерн tokens.json-verify);
 *  5. классификация — границы серой зоны;
 *  6. род-специфичный пересчёт — известная арифметика.
 *
 * Запуск: node --test tests/fecrt.test.mjs   (CI: .github/workflows/ci.yml)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import FECRT from '../fecrt.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1. разбор ввода: RU-запятая и прочие грабли ------------------ */

test('parseCounts: запятая — разделитель списка', () => {
  const r = FECRT.parseCounts('500, 400, 600');
  assert.ok(r.ok);
  assert.deepEqual(r.values, [500, 400, 600]);
});

test('parseCounts: пробелы и переводы строк — те же разделители', () => {
  assert.deepEqual(FECRT.parseCounts('500 400\n600\t300').values, [500, 400, 600, 300]);
  assert.deepEqual(FECRT.parseCounts('500\n400\n600').values, [500, 400, 600]);
});

test('parseCounts: точка с запятой тоже работает (копипаста из таблиц)', () => {
  assert.deepEqual(FECRT.parseCounts('500;400;600').values, [500, 400, 600]);
});

test('parseCounts: пусто — это ноль чисел, а не ошибка', () => {
  const r = FECRT.parseCounts('');
  assert.ok(r.ok);
  assert.deepEqual(r.values, []);
});

test('parseCounts: двойной разделитель — не ошибка (урок Task 178)', () => {
  const r = FECRT.parseCounts('500,,400  600');
  assert.ok(r.ok);
  assert.deepEqual(r.values, [500, 400, 600]);
});

test('parseCounts: мусор перечисляется, разбор падает явно', () => {
  const r = FECRT.parseCounts('abc 500 –- 600');
  assert.equal(r.ok, false);
  assert.deepEqual(r.values, [500, 600]);   /* валидные токены не теряются */
  assert.deepEqual(r.bad, ['abc', '–-']);
});

test('parseCounts: минус — ошибка (яиц не бывает −5)', () => {
  const r = FECRT.parseCounts('-5 500');
  assert.equal(r.ok, false);
  assert.deepEqual(r.bad, ['-5']);
});

/* ---------- 2. точечные формулы — арифметика руками ---------------------- */

test('mean: среднее арифметическое', () => {
  assert.ok(near(FECRT.mean([500, 400, 600, 300]), 450));
  assert.equal(FECRT.mean([]), null);
});

test('fecr парный: 88,(8)% на классическом примере', () => {
  // m1=450, m2=50 → 100×(1−50/450) = 88.888…
  assert.ok(near(FECRT.fecr([500, 400, 600, 300], [50, 0, 100, 50]), 800 / 9, 1e-9));
});

test('fecr парный: полный ноль после лечения = 100%', () => {
  assert.equal(FECRT.fecr([100, 200], [0, 0]), 100);
});

test('fecr парный: нет яиц до лечения — тест не определён', () => {
  assert.equal(FECRT.fecr([0, 0], [0, 0]), null);
});

test('fecrControl: поправка на динамику контрольной группы', () => {
  // T: 400→40 (0.1), C: 500→450 (0.9) → 100×(1−0.1/0.9) = 88.888…
  assert.ok(near(FECRT.fecrControl([400], [40], [500], [450]), 800 / 9, 1e-9));
  // T: 500→100 (0.2), C: 400→400 (1.0) → 80%
  assert.ok(near(FECRT.fecrControl([500], [100], [400], [400]), 80, 1e-9));
});

/* ---------- 3. бутстрэп: детерминированность и золото -------------------- */

test('бутстрэп парный: детерминирован (один ввод — один ДИ)', () => {
  const a = FECRT.bootstrapPaired([500, 400, 600, 300], [50, 0, 100, 50]);
  const b = FECRT.bootstrapPaired([500, 400, 600, 300], [50, 0, 100, 50]);
  assert.deepEqual(a, b);
});

test('бутстрэп парный: ЗОЛОТО интервалов (дрейф = красный CI)', () => {
  const ci = FECRT.bootstrapPaired([500, 400, 600, 300], [50, 0, 100, 50]);
  assert.ok(near(ci.lo, 83.33333333333334, 1e-9));
  assert.ok(near(ci.hi, 94.44444444444444, 1e-9));
  assert.equal(ci.valid, 10000);
  assert.equal(ci.skipped, 0);
});

test('бутстрэп с контролем: ЗОЛОТО интервалов', () => {
  const ci = FECRT.bootstrapControl(
    [500, 400, 600, 300], [50, 0, 100, 50],
    [600, 500, 700, 400], [550, 480, 690, 420]);
  assert.ok(near(ci.lo, 83.09178743961353, 1e-9));
  assert.ok(near(ci.hi, 94.32624113475178, 1e-9));
});

test('бутстрэп: n=1 вырождается в точечную оценку', () => {
  // 600→90 = 85% на любой реплике
  const ci = FECRT.bootstrapPaired([600], [90]);
  assert.ok(near(ci.lo, 85, 1e-9));
  assert.ok(near(ci.hi, 85, 1e-9));
});

test('бутстрэп: свой сид даёт свой (но стабильный) интервал', () => {
  /* 4 животных — слишком дискретный мир: перцентили схлопываются одинаково
   * при любом сиде (проверено). 8 животных уже различают сиды. */
  const pre = [500, 400, 600, 300, 800, 200, 700, 350];
  const post = [50, 0, 100, 50, 120, 10, 90, 20];
  const a = FECRT.bootstrapPaired(pre, post, { seed: 1 });
  const b = FECRT.bootstrapPaired(pre, post, { seed: 1 });
  assert.deepEqual(a, b);
  const c = FECRT.bootstrapPaired(pre, post, { seed: 2 });
  assert.notDeepEqual(a, c);
});

/* ---------- 4. пороги: сверка с референсом (tokens-verify) --------------- */

test('THRESHOLDS: поле-в-поле с tests/thresholds.reference.json', () => {
  const ref = JSON.parse(readFileSync(join(HERE, 'thresholds.reference.json'), 'utf8'));
  assert.equal(FECRT.THRESHOLDS.version, ref.version);
  for (const sp of ['horse', 'smallRuminant', 'cattle']) {
    assert.ok(FECRT.THRESHOLDS[sp], 'вид ' + sp);
    assert.equal(FECRT.THRESHOLDS[sp].nMin, ref[sp].nMin);
    for (const dr of Object.keys(ref[sp].drugs)) {
      const t = FECRT.THRESHOLDS[sp].drugs[dr];
      assert.ok(t, sp + '/' + dr + ' отсутствует');
      assert.equal(t.E, ref[sp].drugs[dr].E, sp + '/' + dr + ' E');
      assert.equal(t.M, ref[sp].drugs[dr].M, sp + '/' + dr + ' M');
    }
  }
});

test('THRESHOLDS: у каждой группы препарата есть человекочитаемый ярлык', () => {
  for (const sp of Object.keys(FECRT.THRESHOLDS)) {
    if (sp === 'version') continue;
    for (const dr of Object.keys(FECRT.THRESHOLDS[sp].drugs)) {
      assert.ok(typeof FECRT.THRESHOLDS[sp].drugs[dr].label === 'string' &&
        FECRT.THRESHOLDS[sp].drugs[dr].label.length > 3);
    }
  }
});

/* ---------- 5. классификация: границы серой зоны -------------------------- */

test('classify: вся 90% ДИ ≥ E — восприимчив', () => {
  assert.equal(FECRT.classify({ lo: 95, hi: 99 }, { E: 95, M: 90 }).code, 'S');
  assert.equal(FECRT.classify({ lo: 96, hi: 99 }, { E: 95, M: 90 }).code, 'S');
});

test('classify: вся 90% ДИ < M — резистентность', () => {
  assert.equal(FECRT.classify({ lo: 80, hi: 89.9 }, { E: 95, M: 90 }).code, 'R');
});

test('classify: ДИ накрывает пороги — серая зона', () => {
  assert.equal(FECRT.classify({ lo: 80, hi: 92 }, { E: 95, M: 90 }).code, 'GREY');
  assert.equal(FECRT.classify({ lo: 93, hi: 96 }, { E: 95, M: 90 }).code, 'GREY');
});

test('classify: лошадиные пороги МЛ жёстче жвачных', () => {
  // 96% на жвачных — серая зона (90–95 не накрывает... lo=96≥95 → S),
  // на лошадином МЛ (E=98) — серая зона
  assert.equal(FECRT.classify({ lo: 96, hi: 97 }, FECRT.THRESHOLDS.smallRuminant.drugs.bzd).code, 'S');
  assert.equal(FECRT.classify({ lo: 96, hi: 97 }, FECRT.THRESHOLDS.horse.drugs.ml).code, 'GREY');
  // а 94% — резистентность для лошадиного МЛ (M=95), но серая зона для БЗД лошади (M=90)
  assert.equal(FECRT.classify({ lo: 92, hi: 94 }, FECRT.THRESHOLDS.horse.drugs.ml).code, 'R');
  assert.equal(FECRT.classify({ lo: 92, hi: 94 }, FECRT.THRESHOLDS.horse.drugs.bzd).code, 'GREY');
});

test('classify: ДИ нет — честная серая зона с причиной', () => {
  const v = FECRT.classify({ lo: null, hi: null }, { E: 95, M: 90 });
  assert.equal(v.code, 'GREY');
});

/* ---------- 6. род-специфичный пересчёт ----------------------------------- */

test('genusSplit: доли культуры × общие счёты — известная арифметика', () => {
  const g = FECRT.genusSplit([1000], [100], [
    { name: 'Haemonchus', pre: 60, post: 90 },
    { name: 'Teladorsagia', pre: 40, post: 10 },
  ]);
  assert.deepEqual(g.warn, []);
  assert.equal(g.rows.length, 2);
  assert.ok(near(g.rows[0].meanPre, 600, 1e-9));
  assert.ok(near(g.rows[0].meanPost, 90, 1e-9));
  assert.ok(near(g.rows[0].fecr, 85, 1e-9));
  assert.ok(near(g.rows[1].meanPre, 400, 1e-9));
  assert.ok(near(g.rows[1].meanPost, 10, 1e-9));
  assert.ok(near(g.rows[1].fecr, 97.5, 1e-9));
});

test('genusSplit: неполная сумма долей — предупреждение, не тишина', () => {
  const g = FECRT.genusSplit([1000], [100], [
    { name: 'Haemonchus', pre: 60, post: 90 },
    { name: 'Teladorsagia', pre: 30, post: 10 },
  ]);
  assert.equal(g.warn.length, 1);
  assert.match(g.warn[0], /100%/);
});

test('genusSplit: род с нулевой долей и до, и после — выпадает', () => {
  const g = FECRT.genusSplit([1000], [100], [
    { name: 'Haemonchus', pre: 60, post: 90 },
    { name: 'Teladorsagia', pre: 40, post: 10 },
    { name: 'Nematodirus', pre: 0, post: 0 },
  ]);
  assert.equal(g.rows.length, 2);
});

/* ---------- 7. полный расчёт compute() ------------------------------------ */

test('compute: сквозной пример овцы×БЗД — точка, ДИ, вердикт', () => {
  const r = FECRT.compute({
    species: 'smallRuminant', drug: 'bzd',
    pre: [500, 400, 600, 300], post: [50, 0, 100, 50],
  });
  assert.equal(r.error, undefined);
  assert.ok(near(r.point, 800 / 9, 1e-9));
  assert.ok(near(r.ci.lo, 83.33333333333334, 1e-9));
  assert.ok(near(r.ci.hi, 94.44444444444444, 1e-9));
  assert.equal(r.verdict.code, 'GREY');
  assert.equal(r.n, 4);
  assert.equal(r.nMin, 10);   /* UI обязан подсветить: животных меньше нормы */
  assert.match(r.nMinSource, /10/);  /* источник нормы доезжает до рендера */
});

test('compute: контрольная группа — поправка включена', () => {
  const r = FECRT.compute({
    species: 'cattle', drug: 'ml',
    pre: [500, 400, 600, 300], post: [50, 0, 100, 50],
    control: { pre: [600, 500, 700, 400], post: [550, 480, 690, 420] },
  });
  assert.equal(r.error, undefined);
  assert.ok(near(r.point, FECRT.fecrControl(
    [500, 400, 600, 300], [50, 0, 100, 50],
    [600, 500, 700, 400], [550, 480, 690, 420]), 1e-9));
  assert.ok(near(r.ci.lo, 83.09178743961353, 1e-9));
});

test('compute: непарные ряды — внятная ошибка', () => {
  const r = FECRT.compute({
    species: 'smallRuminant', drug: 'bzd',
    pre: [500, 400], post: [50],
  });
  assert.match(r.error, /не совпадает/);
});

test('compute: нет яиц до лечения — тест не определён', () => {
  const r = FECRT.compute({
    species: 'horse', drug: 'ml',
    pre: [0, 0, 0], post: [0, 0, 0],
  });
  assert.match(r.error, /нулю|нет яиц/);
});

test('compute: неизвестный вид/препарат — ошибка, не тихий NaN', () => {
  assert.match(FECRT.compute({ species: 'dog', drug: 'bzd', pre: [1], post: [1] }).error, /вид/);
  assert.match(FECRT.compute({ species: 'horse', drug: 'lvm', pre: [1], post: [1] }).error, /препарата/);
});

test('compute: род-специфичный режим добавляет строки с вердиктами', () => {
  const r = FECRT.compute({
    species: 'smallRuminant', drug: 'bzd',
    pre: [500, 400, 600, 300], post: [50, 0, 100, 50],
    genus: [
      { name: 'Haemonchus', pre: 60, post: 90 },
      { name: 'Teladorsagia', pre: 40, post: 10 },
    ],
  });
  assert.equal(r.genus.rows.length, 2);
  /* 4 пробы × доли: H — mean 270→45 = 83,(3)%; T — mean 180→5 = 97,(2)% */
  assert.ok(near(r.genus.rows[0].fecr, 250 / 3, 1e-9));
  assert.ok(near(r.genus.rows[1].fecr, 350 / 3.6, 1e-9));
  assert.ok(r.genus.rows[1].verdict.code === 'S' || r.genus.rows[1].verdict.code === 'GREY');
});

/* ---------- 8. волна Task 182: целые EPG и сквозные границы --------------- */

test('parseCounts: точка — не дробь: EPG целые (аудит 181-a)', () => {
  const r = FECRT.parseCounts('1.5 500');
  assert.equal(r.ok, false);
  assert.deepEqual(r.bad, ['1.5']);
  assert.deepEqual(r.values, [500]);   /* валидные не теряются */
});

test('parseCounts: «37,5» — это два числа 37 и 5 (запятая — разделитель списка)', () => {
  const r = FECRT.parseCounts('37,5');
  assert.ok(r.ok);
  assert.deepEqual(r.values, [37, 5]);
});

test('compute: пустые ряды — внятная ошибка, не тихий NaN', () => {
  const r = FECRT.compute({ species: 'smallRuminant', drug: 'bzd', pre: [], post: [] });
  assert.match(r.error, /введите/);
});

test('compute: полный ноль после лечения — 100%, вердикт «восприимчив»', () => {
  const r = FECRT.compute({
    species: 'smallRuminant', drug: 'bzd',
    pre: [500, 400, 600, 300], post: [0, 0, 0, 0],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.point, 100);
  assert.equal(r.verdict.code, 'S');
});

test('compute: счёт не снизился — 0%, вердикт «резистентность»', () => {
  const r = FECRT.compute({
    species: 'smallRuminant', drug: 'bzd',
    pre: [500, 400, 600, 300], post: [500, 400, 600, 300],
  });
  assert.ok(near(r.point, 0, 1e-9));
  assert.equal(r.verdict.code, 'R');
});

test('classify: верх ДИ ровно на минимуме M — серая зона (сравнение строгое)', () => {
  assert.equal(FECRT.classify({ lo: 80, hi: 90 }, { E: 95, M: 90 }).code, 'GREY');
});

test('compute: n=1 — не падает, ДИ схлопывается в точку', () => {
  const r = FECRT.compute({ species: 'horse', drug: 'ml', pre: [600], post: [90] });
  assert.equal(r.error, undefined);
  assert.ok(near(r.point, 85, 1e-9));
  assert.ok(near(r.ci.lo, 85, 1e-9));
  assert.ok(near(r.ci.hi, 85, 1e-9));
  assert.equal(r.n, 1);
  assert.equal(r.nMin, 6);
});
