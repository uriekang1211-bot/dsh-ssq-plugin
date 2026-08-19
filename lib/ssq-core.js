/* ============================================================
 * dsh-ssq-plugin 核心逻辑（ESM，供 DSH Host 工具使用）
 * 与浏览器单文件版 src/app.js 中的纯函数保持一致（test.cjs 会做一致性校验）
 * ============================================================ */

/** 数据规范化：接受 {result:[...]}（cwl 格式，最新在前）或裸数组 */
export function normalize(raw) {
  let list = null;
  if (raw && Array.isArray(raw)) list = raw;
  else if (raw && Array.isArray(raw.result)) list = raw.result;
  if (!list) return [];
  const out = [];
  for (const d of list) {
    const red = String(d.red != null ? d.red : "")
      .split(",").map(s => parseInt(s, 10))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 33);
    const blue = parseInt(d.blue, 10);
    if (red.length !== 6 || !(blue >= 1 && blue <= 16)) continue;
    out.push({
      issue: String(d.code != null ? d.code : (d.issue || "")),
      date: String(d.date || "").replace(/\(.*\)$/, ""),
      red, blue
    });
  }
  out.reverse(); // 最新在前 → 时间正序
  return out;
}

/**
 * 增量合并：把在线拉取的最新若干期（fresh）并入本地保存的历史基线（baseline）。
 * 按期号去重、时间正序、截取最近 max 期；返回新增期数 addedCount 与连续性
 * 检测结果 hasGap（期号中间断开视为缺口，跨年衔接 YYYY001 接 YYYYxxx 视为连续）。
 * @param baseline - 本地保存的历史（时间正序）
 * @param fresh - 在线拉取的新数据（时间正序，可为空）
 * @param max - 最多保留的期数，默认 1000
 */
export function mergeDraws(baseline, fresh, max = 1000) {
  const byIssue = new Map();
  for (const d of [...(baseline || []), ...(fresh || [])]) {
    if (d && d.issue && !byIssue.has(d.issue)) byIssue.set(d.issue, d);
  }
  const all = [...byIssue.values()].sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0));
  const baseSet = new Set((baseline || []).map(d => d.issue));
  const addedCount = (fresh || []).filter(d => d && d.issue && !baseSet.has(d.issue)).length;
  const draws = all.slice(-max);
  let hasGap = false;
  for (let i = 1; i < draws.length; i++) {
    const p = draws[i - 1].issue, c = draws[i].issue;
    if (!/^\d+$/.test(p) || !/^\d+$/.test(c)) continue;
    const pn = Number(p), cn = Number(c);
    if (cn === pn + 1) continue;
    const py = Math.floor(pn / 1000), cy = Math.floor(cn / 1000);
    if (cy === py + 1 && cn % 1000 === 1) continue; // 跨年衔接
    hasGap = true;
    break;
  }
  return { draws, addedCount, hasGap };
}

/** 统计：窗口 W 期内每个红球/蓝球号码的表现 */
export function computeStats(draws, windowSize) {
  const W = Math.min(windowSize, draws.length);
  const win = draws.slice(-W);
  const red = Array.from({ length: 33 }, (_, i) => ({ n: i + 1, cnt: 0, last10: 0, prev10: 0 }));
  const blue = Array.from({ length: 16 }, (_, i) => ({ n: i + 1, cnt: 0, last10: 0, prev10: 0 }));
  const redHit = Array.from({ length: 33 }, () => new Array(W).fill(0));
  const blueHit = Array.from({ length: 16 }, () => new Array(W).fill(0));

  win.forEach((d, di) => {
    for (const n of d.red) { red[n - 1].cnt++; redHit[n - 1][di] = 1; }
    blue[d.blue - 1].cnt++; blueHit[d.blue - 1][di] = 1;
  });

  const l10 = Math.min(10, W);
  win.slice(-l10).forEach(d => {
    for (const n of d.red) red[n - 1].last10++;
    blue[d.blue - 1].last10++;
  });
  if (W >= 20) {
    win.slice(-20, -10).forEach(d => {
      for (const n of d.red) red[n - 1].prev10++;
      blue[d.blue - 1].prev10++;
    });
  } else {
    red.forEach(r => r.prev10 = r.cnt - r.last10);
    blue.forEach(b => b.prev10 = b.cnt - b.last10);
  }

  const DECAY = 0.92;
  const zscore = arr => {
    const m = arr.reduce((a, x) => a + x, 0) / arr.length;
    const s = Math.sqrt(arr.reduce((a, x) => a + (x - m) * (x - m), 0) / arr.length) || 1;
    return arr.map(x => (x - m) / s);
  };

  const analyze = (arr, hit, isRed) => {
    const mean = isRed ? 6 * W / 33 : W / 16;
    const sd = Math.sqrt((isRed ? 6 * W : W) * (1 / (isRed ? 33 : 16)) * (1 - 1 / (isRed ? 33 : 16)));
    const rec = hit.map((row, i) => {
      let s = 0;
      for (let di = 0; di < W; di++) s += row[di] * Math.pow(DECAY, W - 1 - di);
      return s;
    });
    const recZ = zscore(rec);
    // EWMA 信号：半衰期 20 期的指数加权出现频率（z 标准化），供「EWMA 近期加权」模型使用
    const EWMA_HALF = 20;
    const ewma = hit.map(row => {
      let s = 0;
      for (let di = 0; di < W; di++) s += row[di] * Math.pow(0.5, (W - 1 - di) / EWMA_HALF);
      return s;
    });
    const ewmaZ = zscore(ewma);
    const gap = hit.map(row => {
      let g = 0;
      for (let di = W - 1; di >= 0 && row[di] === 0; di--) g++;
      return g;
    });
    const maxGap = hit.map(row => {
      let m = 0, c = 0;
      for (let di = 0; di < W; di++) { c = row[di] === 0 ? c + 1 : 0; if (c > m) m = c; }
      return m;
    });
    const ratio = arr.map((it, i) => {
      const avg = it.cnt > 0 ? W / it.cnt : W + 1;
      return (gap[i] + 0.5) / (avg + 0.5);
    });
    const ratioZ = zscore(ratio);
    arr.forEach((it, i) => {
      const z = (it.cnt - mean) / sd;
      it.freq = it.cnt / (isRed ? 6 * W : W);
      it.zFreq = z;
      it.rec = recZ[i];
      it.ewma = ewmaZ[i];
      it.gap = gap[i];
      it.maxGap = maxGap[i];
      it.avgGap = it.cnt > 0 ? W / it.cnt : W + 1;
      it.ratioZ = ratioZ[i];
      it.status = z > 0.5 ? "hot" : z < -0.5 ? "cold" : "warm";
      it.trend = it.last10 > it.prev10 ? "up" : it.last10 < it.prev10 ? "down" : "flat";
      it.lastIssue = "—";
      for (let di = W - 1; di >= 0; di--) {
        if (hit[i][di] === 1) { it.lastIssue = win[di].issue; break; }
      }
    });
  };
  analyze(red, redHit, true);
  analyze(blue, blueHit, false);

  return { windowSize: W, draws: win, red, blue, latest: win[W - 1] };
}

/** 预测模型预设 */
export const PRESETS = {
  balanced: { label: "均衡混合", w: { freq: 0.40, rec: 0.30, gap: 0.30, ewma: 0 } },
  cold:     { label: "冷号回补", w: { freq: 0.15, rec: 0.10, gap: 0.75, ewma: 0 } },
  hot:      { label: "热号延续", w: { freq: 0.60, rec: 0.35, gap: 0.05, ewma: 0 } },
  ewma:     { label: "EWMA 近期加权", w: { freq: 0, rec: 0, gap: 0, ewma: 1 } },
  miss:     { label: "遗漏均值回归", w: { freq: 0, rec: 0, gap: 1, ewma: 0 } },
  expect:   { label: "期望偏差回补", w: { freq: -1, rec: 0, gap: 0, ewma: 0 } }
};

export function softmax(arr) {
  const m = Math.max(...arr);
  const ex = arr.map(x => Math.exp(x - m));
  const s = ex.reduce((a, x) => a + x, 0);
  return ex.map(x => x / s);
}

/** 预测：频率 + 近期衰减 + 遗漏回补 + EWMA 加权评分 → softmax 概率 */
export function predict(stats, presetKey) {
  const p = PRESETS[presetKey] || PRESETS.balanced;
  const score = item => item.map(it =>
    p.w.freq * it.zFreq + p.w.rec * it.rec + p.w.gap * it.ratioZ + (p.w.ewma || 0) * it.ewma
  );
  const redP = softmax(score(stats.red));
  const blueP = softmax(score(stats.blue));
  const redOut = stats.red.map((r, i) => ({
    n: r.n, p: redP[i], exp: 6 * redP[i], zFreq: r.zFreq, zRec: r.rec, zGap: r.ratioZ, zEwma: r.ewma
  })).sort((a, b) => b.p - a.p);
  const blueOut = stats.blue.map((b, i) => ({
    n: b.n, p: blueP[i], zFreq: b.zFreq, zRec: b.rec, zGap: b.ratioZ, zEwma: b.ewma
  })).sort((a, b) => b.p - a.p);
  return {
    model: p.label,
    red: redOut,
    blue: blueOut,
    rec: {
      red: redOut.slice(0, 6).map(x => x.n).sort((a, b) => a - b),
      blue: blueOut[0].n,
      blueAlt: blueOut.slice(0, 3).map(x => x.n)
    }
  };
}

/** 集成投票：跑全部预设，各自取红球 Top6 与蓝球 Top1 投票，票数高者胜出（同票按平均概率排序） */
export function ensemble(stats, presetKeys = Object.keys(PRESETS)) {
  const votes = {};
  const avgP = {};
  for (const key of presetKeys) {
    const p = predict(stats, key);
    for (const r of p.red.slice(0, 6)) {
      votes[r.n] = (votes[r.n] || 0) + 1;
      avgP[r.n] = (avgP[r.n] || 0) + r.p;
    }
    const b = p.rec.blue;
    votes["b" + b] = (votes["b" + b] || 0) + 1;
  }
  const redNums = Object.keys(votes).filter(k => !k.startsWith("b")).map(Number)
    .sort((a, b) => votes[b] - votes[a] || (avgP[b] / votes[b]) - (avgP[a] / votes[a]));
  const blueNums = Object.keys(votes).filter(k => k.startsWith("b")).map(k => Number(k.slice(1)))
    .sort((a, b) => votes["b" + b] - votes["b" + a]);
  const red = redNums.map(n => ({ n, votes: votes[n], p: +(avgP[n] || 0) }));
  const blue = blueNums.map(n => ({ n, votes: votes["b" + n], p: 1 }));
  return {
    model: "集成投票",
    presetKeys,
    red,
    blue,
    rec: {
      red: redNums.slice(0, 6).sort((a, b) => a - b),
      blue: blueNums[0],
      blueAlt: blueNums.slice(0, 3)
    }
  };
}

/** 组合结构统计：窗口内每期红球的奇偶比 / 大小比 / 三区间分布 / 和值区间的历史频率 */
export function structureStats(draws, windowSize) {
  const W = Math.min(windowSize, draws.length);
  const win = draws.slice(-W);
  const oddEven = {}, size = {}, zone = {}, sumBins = {};
  const SUM_BINS = [["≤60", 60], ["61-80", 80], ["81-100", 100], ["101-120", 120], ["121-140", 140], [">140", Infinity]];
  for (const d of win) {
    const red = d.red;
    const oe = red.filter(n => n % 2 === 1).length + ":" + red.filter(n => n % 2 === 0).length;
    const sz = red.filter(n => n <= 16).length + ":" + red.filter(n => n > 16).length;
    const z = [0, 0, 0];
    for (const n of red) z[n <= 11 ? 0 : n <= 22 ? 1 : 2]++;
    const s = red.reduce((a, n) => a + n, 0);
    oddEven[oe] = (oddEven[oe] || 0) + 1;
    size[sz] = (size[sz] || 0) + 1;
    zone[z.join(":")] = (zone[z.join(":")] || 0) + 1;
    const sb = SUM_BINS.find(([, max]) => s <= max)[0];
    sumBins[sb] = (sumBins[sb] || 0) + 1;
  }
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([key, cnt]) => ({ key, cnt, freq: +(cnt / W).toFixed(4) }));
  return {
    windowSize: W,
    oddEven: top(oddEven),
    size: top(size),
    zone: top(zone),
    sum: top(sumBins),
    latest: win[W - 1]
  };
}

/** 按给定结构约束（奇偶比/大小比/三区间）随机生成 n 注选号（拒绝采样） */
export function genStructureCombos(structure, n) {
  const oddEven = structure.oddEven.split(":").map(Number);   // [奇, 偶]
  const size = structure.size.split(":").map(Number);         // [小, 大]
  const zone = structure.zone.split(":").map(Number);         // [1-11, 12-22, 23-33]
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 5000 + 2000) {
    guard++;
    const pool = Array.from({ length: 33 }, (_, i) => i + 1);
    const red = [];
    // 先按三区间配额抽取
    const zones = [[1, 11], [12, 22], [23, 33]];
    for (let zi = 0; zi < 3; zi++) {
      const [lo, hi] = zones[zi];
      const cand = pool.filter(v => v >= lo && v <= hi);
      for (let k = 0; k < zone[zi]; k++) {
        const idx = Math.floor(Math.random() * cand.length);
        red.push(cand.splice(idx, 1)[0]);
      }
    }
    // 校验奇偶比与大小比（不满足则拒绝，重新采样）
    const odd = red.filter(v => v % 2 === 1).length;
    const small = red.filter(v => v <= 16).length;
    if (odd !== oddEven[0] || small !== size[0]) continue;
    red.sort((a, b) => a - b);
    out.push({ red, blue: 1 + Math.floor(Math.random() * 16) });
  }
  return out;
}

export function simulateWeighted(pool, k, weights) {
  const items = pool.map((v, i) => ({ v, w: Math.max(weights[i], 1e-9) }));
  const out = [];
  for (let s = 0; s < k; s++) {
    const total = items.reduce((a, x) => a + x.w, 0);
    let r = Math.random() * total, idx = 0;
    for (let i = 0; i < items.length; i++) {
      r -= items[i].w;
      if (r <= 0) { idx = i; break; }
    }
    out.push(items[idx].v);
    items.splice(idx, 1);
  }
  return out;
}

export function cnk(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}

export function* combos(arr, k) {
  if (k === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combos(arr.slice(i + 1), k - 1)) {
      yield [arr[i]].concat(rest);
    }
  }
}

/** 纯随机生成 n 注 */
export function genRandom(n) {
  const nums = Array.from({ length: 33 }, (_, i) => i + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const red = simulateWeighted(nums, 6, nums.map(() => 1)).sort((a, b) => a - b);
    out.push({ red, blue: 1 + Math.floor(Math.random() * 16) });
  }
  return out;
}

/** 胆拖生成：opts.all=true 生成全部（最多 5000 注），否则随机抽取 opts.n 注 */
export function genDanTuo(dan, tuo, blues, opts) {
  const d = dan.length, t = tuo.length, b = blues.length;
  const need = 6 - d;
  if (!(d >= 1 && d <= 5)) return { error: "胆码数量需为 1–5 个" };
  if (t < need) return { error: `拖码至少需要 ${need} 个（当前 ${t} 个）` };
  if (b < 1) return { error: "请至少选择 1 个蓝球" };
  const total = cnk(t, need) * b;
  const wantAll = opts && opts.all;
  const sampleN = opts && opts.n ? opts.n : 0;

  if (wantAll) {
    const MAX = 5000;
    const list = [];
    for (const drag of combos(tuo, need)) {
      for (const bl of blues) {
        if (list.length >= MAX) break;
        list.push({ red: dan.concat(drag).sort((a, b) => a - b), blue: bl });
      }
      if (list.length >= MAX) break;
    }
    return { ok: true, total, limited: total > MAX, list };
  }

  const set = new Set();
  const list = [];
  const n = Math.min(sampleN, total);
  let guard = 0;
  while (list.length < n && guard < n * 200 + 500) {
    guard++;
    const drag = simulateWeighted(tuo, need, tuo.map(() => 1)).sort((a, b) => a - b);
    const bl = blues[Math.floor(Math.random() * b)];
    const key = drag.join(",") + "|" + bl;
    if (set.has(key)) continue;
    set.add(key);
    list.push({ red: dan.concat(drag).sort((a, b) => a - b), blue: bl });
  }
  return { ok: true, total, limited: false, list };
}
