/*!
 * fecrt.js — математическое ядро витрины «ФЭКРТ» (vetfecrt-site)
 * Тест снижения числа яиц гельминтов (FECRT) по гайдлайну WAAVP-2023.
 *
 * Один и тот же файл питает онлайн-калькулятор и тесты
 * (tests/fecrt.test.mjs): известные ответы гейтят математику.
 *
 * Методика:
 *  - парный дизайн (рекомендация WAAVP-2023):
 *      FECR% = 100 × (1 − mean(после) / mean(до)), средние арифметические;
 *  - дизайн с контрольной группой (классика WAAVP, Coles et al. 1992):
 *      FECR% = 100 × (1 − (T2/T1) / (C2/C1));
 *  - 90% ДИ — перцентильный бутстрэп; 90%, а не 95%, потому что
 *    классификация — два односторонних теста по 5% (Denwood et al. 2023,
 *    Vet Parasitol 314:109867, каркас под гайдлайн WAAVP-2023);
 *  - генератор случайных чисел детерминированный (mulberry32,
 *    фиксированный сид) — одинаковый ввод всегда даёт одинаковый ДИ;
 *  - классификация: «восприимчив» — вся 90% ДИ ≥ E (ожидаемая
 *    эффективность); «резистентность» — вся 90% ДИ < M (минимум);
 *    между порогами — серая зона. E и M — пороги вида × препарата,
 *    см. THRESHOLDS (сверка: tests/thresholds.reference.json).
 *
 * Гайдлайн — полевой инструмент: не эталонный метод (валидация против
 * убойных исследований не проводилась, у КРС — адаптация с овец).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FECRT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- детерминированный ГПСЧ: mulberry32 ------------------------------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SEED = 0x00FEC271;   /* фиксированный: ДИ воспроизводим, гейтится золотом */
  var ITERS = 10000;       /* реплик бутстрэпа */

  /* ---- разбор ввода счётов: RU-запятая как разделитель списка ----------- */
  /* Урок Task 178 (ветвойс): русская запятая — главный молчаливый убийца
   * числового ввода. Здесь запятая/точка-с-запятой/пробелы/переводы строк —
   * РАВНОЦЕННЫЕ разделители списка; мусор и минусы — ошибки с перечислением. */
  function parseCounts(text) {
    var out = { ok: false, values: [], bad: [] };
    if (typeof text !== 'string' || text.trim() === '') { out.ok = true; return out; }
    var tokens = text.split(/[\s,;\n\r\t]+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === '') continue;                      /* двойной разделитель — не ошибка */
      if (!/^\d+(\.\d+)?$/.test(t)) { out.bad.push(t); continue; }
      var v = parseFloat(t);
      if (v < 0) { out.bad.push(t); continue; }
      out.values.push(v);
    }
    out.ok = out.bad.length === 0;
    return out;
  }

  function mean(a) {
    if (!a || a.length === 0) return null;
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }

  /* ---- точечные оценки --------------------------------------------------- */
  /* Парный дизайн. null — если до лечения яиц нет (знаменатель 0). */
  function fecr(pre, post) {
    var m1 = mean(pre), m2 = mean(post);
    if (m1 === null || m1 === 0) return null;
    if (m2 === 0) return 100;
    return 100 * (1 - m2 / m1);
  }

  /* Дизайн с контрольной группой: поправка на естественную динамику
   * яиц в необработанной группе. null — если нулевой знаменатель. */
  function fecrControl(t1, t2, c1, c2) {
    var mT1 = mean(t1), mT2 = mean(t2), mC1 = mean(c1), mC2 = mean(c2);
    if (!mT1 || !mC1) return null;
    var ctrl = mC2 / mC1;
    if (ctrl === 0) return 100;
    return 100 * (1 - (mT2 / mT1) / ctrl);
  }

  /* ---- бутстрэп 90% ДИ --------------------------------------------------- */
  /* Перцентили: k5 = ⌈0.05N⌉-я статистика, k95 = ⌊0.95N⌋+1-я (0-индексация),
   * определение фиксировано — золотые ответы тестов стабильно бьют в него. */
  function percentile(sorted, p, n) {
    var k = Math.ceil(p * n) - 1;
    if (k < 0) k = 0;
    if (k > n - 1) k = n - 1;
    return sorted[k];
  }

  function resample(rnd, arr, idxs) {
    var s = 0;
    for (var j = 0; j < idxs.length; j++) s += arr[idxs[j]];
    return s / idxs.length;
  }

  function drawIdx(rnd, n) {
    var idx = new Array(n);
    for (var j = 0; j < n; j++) idx[j] = Math.floor(rnd() * n);
    return idx;
  }

  /* Парный бутстрэп: реплика = перевыборка ПАР (до/после одних животных). */
  function bootstrapPaired(pre, post, opts) {
    opts = opts || {};
    var seed = (opts.seed === undefined) ? SEED : opts.seed;
    var iters = opts.iters || ITERS;
    var n = pre.length;
    if (n === 0 || n !== post.length) return { lo: null, hi: null, iters: iters, valid: 0 };
    var rnd = mulberry32(seed);
    var reps = [], skipped = 0;
    for (var i = 0; i < iters; i++) {
      var idx = drawIdx(rnd, n);
      var m1 = resample(rnd, pre, idx);
      if (m1 === 0) { skipped++; continue; }
      var m2 = resample(rnd, post, idx);
      reps.push(m2 === 0 ? 100 : 100 * (1 - m2 / m1));
    }
    if (reps.length < Math.max(100, iters / 100)) {   /* выродился — данных нет */
      return { lo: null, hi: null, iters: iters, valid: reps.length, skipped: skipped };
    }
    reps.sort(function (a, b) { return a - b; });
    var N = reps.length;
    return {
      lo: percentile(reps, 0.05, N),
      hi: percentile(reps, 0.95, N),
      iters: iters, valid: N, skipped: skipped
    };
  }

  /* Бутстрэп с контролем: лечёная и контрольная группы перевыбираются
   * независимо. */
  function bootstrapControl(t1, t2, c1, c2, opts) {
    opts = opts || {};
    var seed = (opts.seed === undefined) ? SEED : opts.seed;
    var iters = opts.iters || ITERS;
    var nT = t1.length, nC = c1.length;
    if (nT === 0 || nT !== t2.length || nC === 0 || nC !== c2.length) {
      return { lo: null, hi: null, iters: iters, valid: 0 };
    }
    var rnd = mulberry32(seed);
    var reps = [], skipped = 0;
    for (var i = 0; i < iters; i++) {
      var iT = drawIdx(rnd, nT), iC = drawIdx(rnd, nC);
      var mT1 = resample(rnd, t1, iT), mT2 = resample(rnd, t2, iT);
      var mC1 = resample(rnd, c1, iC), mC2 = resample(rnd, c2, iC);
      if (mT1 === 0 || mC1 === 0) { skipped++; continue; }
      var ctrl = mC2 / mC1;
      reps.push(ctrl === 0 ? 100 : 100 * (1 - (mT2 / mT1) / ctrl));
    }
    if (reps.length < Math.max(100, iters / 100)) {
      return { lo: null, hi: null, iters: iters, valid: reps.length, skipped: skipped };
    }
    reps.sort(function (a, b) { return a - b; });
    var N = reps.length;
    return {
      lo: percentile(reps, 0.05, N),
      hi: percentile(reps, 0.95, N),
      iters: iters, valid: N, skipped: skipped
    };
  }

  /* ---- пороги вида × препарата (константы со ссылками) ------------------- */
  /* E — ожидаемая эффективность (вся 90% ДИ ≥ E → «восприимчив»),
   * M — минимум (вся 90% ДИ < M → «резистентность»); между — серая зона.
   * Источники:
   *  - лошади: NOAH (Великобритания), FECRT Testing in Horses —
   *    БЗД: S>95 / подозрение 90–95 / R<90; пирантел: S>90 / 85–90 / <85;
   *    ивермектин-моксидектин: S>98 / 95–98 / <95; n ≥ 6, порог
   *    обнаружения метода < 25 EPG, проба на 14-й день;
   *  - мелкие жвачные: классика WAAVP (Coles et al. 1992: <95% —
   *    подозрение на резистентность) и операционализация WAAVP-2023
   *    (Maurizio et al., BMC Vet Res 2024: expected 95% / minimum 90%);
   *  - КРС: адаптация классики с овец (O'Shaughnessy et al., Ir Vet J
   *    2019: FECR <95% при нижней границе ДИ <90% — резистентность),
   *    БЕЗ валидации против убойных исследований.
   * Сверка порогов — tests/thresholds.reference.json (паттерн tokens-verify). */
  var THRESHOLDS = Object.freeze({
    version: 'fecrt-thresholds v1.0 (2026-10-28)',
    horse: Object.freeze({
      label: 'лошади',
      nMin: 6,
      nMinSource: 'NOAH: ≥ 6 лошадей',
      intervalDays: '14 дней после лечения',
      drugs: Object.freeze({
        bzd: Object.freeze({ label: 'бензимидазолы (фенбендазол, оксибендазол, фебантел)', E: 95, M: 90 }),
        pyr: Object.freeze({ label: 'пирантел', E: 90, M: 85 }),
        ml:  Object.freeze({ label: 'ивермектин / моксидектин (макроциклические лактоны)', E: 98, M: 95 })
      })
    }),
    smallRuminant: Object.freeze({
      label: 'мелкие жвачные (овцы, козы)',
      nMin: 10,
      nMinSource: 'классика WAAVP: ≥ 10 животных в группе',
      intervalDays: 'по препарату: левамизол 7–10 д, БЗД 10–14 д, МЛ 14–17 д, моксидектин 17–21 д',
      drugs: Object.freeze({
        bzd: Object.freeze({ label: 'бензимидазолы (албендазол, фенбендазол и др.)', E: 95, M: 90 }),
        lvm: Object.freeze({ label: 'левамизол', E: 95, M: 90 }),
        ml:  Object.freeze({ label: 'макроциклические лактоны (ивермектин и др.)', E: 95, M: 90 }),
        mox: Object.freeze({ label: 'моксидектин', E: 95, M: 90 })
      })
    }),
    cattle: Object.freeze({
      label: 'крупный рогатый скот',
      nMin: 10,
      nMinSource: 'классика WAAVP: ≥ 10 животных в группе',
      intervalDays: 'по препарату (обычно 14–17 д для МЛ); см. справку',
      drugs: Object.freeze({
        bzd: Object.freeze({ label: 'бензимидазолы (фенбендазол, альбендазол и др.)', E: 95, M: 90 }),
        lvm: Object.freeze({ label: 'левамизол', E: 95, M: 90 }),
        ml:  Object.freeze({ label: 'макроциклические лактоны (ивермектин, эприномектин и др.)', E: 95, M: 90 }),
        mox: Object.freeze({ label: 'моксидектин', E: 95, M: 90 })
      })
    })
  });

  /* ---- классификация (два односторонних теста по Denwood 2023) ----------- */
  function classify(ci, thr) {
    if (!thr) return null;
    var lo = ci.lo, hi = ci.hi;
    if (lo === null || hi === null) {
      return { code: 'GREY', why: 'данных для ДИ недостаточно' };
    }
    if (lo >= thr.E) {
      return { code: 'S', why: 'нижняя граница 90% ДИ ≥ ожидаемой эффективности (' + thr.E + '%)' };
    }
    if (hi < thr.M) {
      return { code: 'R', why: 'верхняя граница 90% ДИ ниже минимума (' + thr.M + '%)' };
    }
    return { code: 'GREY', why: '90% ДИ накрывает пороги (' + thr.M + '–' + thr.E + '%) — серая зона' };
  }

  /* ---- род-специфичный пересчёт (жвачные) -------------------------------- */
  /* Яйца стронгилят жвачных неразличимы — роды взвешивают культурой L3
   * (Maurizio et al. 2024: доля рода до/после × общий счёт каждой пробы).
   * shares — [{name, pre, post}] в процентах; суммы должны быть ~100. */
  function genusSplit(totalPre, totalPost, shares) {
    var rows = [];
    var sumPre = 0, sumPost = 0, i, s;
    for (i = 0; i < shares.length; i++) {
      sumPre += shares[i].pre; sumPost += shares[i].post;
    }
    var warn = [];
    if (Math.abs(sumPre - 100) > 0.5) warn.push('доли до лечения в сумме ' + sumPre + '%, а не 100%');
    if (Math.abs(sumPost - 100) > 0.5) warn.push('доли после лечения в сумме ' + sumPost + '%, а не 100%');
    for (i = 0; i < shares.length; i++) {
      s = shares[i];
      if ((s.pre === 0 && s.post === 0)) continue;
      var pre = totalPre.map(function (v) { return v * s.pre / 100; });
      var post = totalPost.map(function (v) { return v * s.post / 100; });
      rows.push({
        name: s.name,
        sharePre: s.pre, sharePost: s.post,
        pre: pre, post: post,
        meanPre: mean(pre), meanPost: mean(post),
        fecr: fecr(pre, post)
      });
    }
    return { rows: rows, warn: warn };
  }

  /* ---- полный расчёт ------------------------------------------------------ */
  function compute(input) {
    /* input: {species, drug, pre, post, control:{pre,post}, genus:[shares]} */
    var sp = THRESHOLDS[input.species];
    if (!sp) return { error: 'неизвестный вид' };
    var thr = sp.drugs[input.drug];
    if (!thr) return { error: 'неизвестная группа препарата' };

    var pre = input.pre || [], post = input.post || [];
    if (pre.length === 0 || post.length === 0) return { error: 'введите счёты до и после лечения' };
    if (pre.length !== post.length) {
      return { error: 'число проб до (' + pre.length + ') и после (' + post.length + ') не совпадает — парный дизайн требует одних и тех же животных' };
    }

    var out = {
      species: sp.label, drug: thr.label, thr: thr,
      n: pre.length,
      meanPre: mean(pre), meanPost: mean(post),
      nMin: sp.nMin, nMinSource: sp.nMinSource, intervalDays: sp.intervalDays
    };

    if (input.control) {
      var cPre = input.control.pre || [], cPost = input.control.post || [];
      if (cPre.length === 0 || cPost.length === 0 || cPre.length !== cPost.length) {
        return { error: 'контрольная группа: введите парные счёты до и после' };
      }
      out.point = fecrControl(pre, post, cPre, cPost);
      out.ci = bootstrapControl(pre, post, cPre, cPost);
      out.control = { n: cPre.length, meanPre: mean(cPre), meanPost: mean(cPost) };
    } else {
      out.point = fecr(pre, post);
      out.ci = bootstrapPaired(pre, post);
    }
    if (out.point === null) {
      return { error: 'средний счёт до лечения равен нулю — ФЭКРТ не определён (нет яиц — нет теста)' };
    }

    out.verdict = classify(out.ci, thr);

    if (input.genus && input.genus.length) {
      out.genus = genusSplit(pre, post, input.genus);
      for (var i = 0; i < out.genus.rows.length; i++) {
        var r = out.genus.rows[i];
        r.ci = bootstrapPaired(r.pre, r.post);
        r.verdict = classify(r.ci, thr);
      }
    }
    return out;
  }

  return {
    SEED: SEED, ITERS: ITERS,
    parseCounts: parseCounts, mean: mean,
    fecr: fecr, fecrControl: fecrControl,
    bootstrapPaired: bootstrapPaired, bootstrapControl: bootstrapControl,
    classify: classify, genusSplit: genusSplit,
    THRESHOLDS: THRESHOLDS, compute: compute
  };
});
