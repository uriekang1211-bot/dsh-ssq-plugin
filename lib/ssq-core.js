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
  balanced: { label: "均衡混合", w: { freq: 0.40, rec: 0.30, gap: 0.30 } },
  cold:     { label: "冷号回补", w: { freq: 0.15, rec: 0.10, gap: 0.75 } },
  hot:      { label: "热号延续", w: { freq: 0.60, rec: 0.35, gap: 0.05 } }
};

export function softmax(arr) {
  const m = Math.max(...arr);
  const ex = arr.map(x => Math.exp(x - m));
  const s = ex.reduce((a, x) => a + x, 0);
  return ex.map(x => x / s);
}

/** 预测：频率 + 近期衰减 + 遗漏回补 加权评分 → softmax 概率 */
export function predict(stats, presetKey) {
  const p = PRESETS[presetKey] || PRESETS.balanced;
  const score = item => item.map(it =>
    p.w.freq * it.zFreq + p.w.rec * it.rec + p.w.gap * it.ratioZ
  );
  const redP = softmax(score(stats.red));
  const blueP = softmax(score(stats.blue));
  const redOut = stats.red.map((r, i) => ({
    n: r.n, p: redP[i], exp: 6 * redP[i], zFreq: r.zFreq, zRec: r.rec, zGap: r.ratioZ
  })).sort((a, b) => b.p - a.p);
  const blueOut = stats.blue.map((b, i) => ({
    n: b.n, p: blueP[i], zFreq: b.zFreq, zRec: b.rec, zGap: b.ratioZ
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
