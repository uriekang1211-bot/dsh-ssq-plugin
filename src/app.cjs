/* ============================================================
 * 双色球助手 (SSQ Helper)
 * 1) 百期趋势追踪：每个红球/蓝球号码在历史窗口中的出现次数、频率、
 *    遗漏、热度状态、走势图、热力图
 * 2) 智能预测：基于 频率 + 近期衰减 + 遗漏回补 三信号的加权评分模型
 *    （纯统计娱乐算法，不改变随机本质）
 * 3) 选号生成：纯随机 / 双色球胆拖规则（胆码+拖码+蓝球）
 * ============================================================ */
"use strict";

const RAW_DATA = (typeof EMBEDDED_DATA !== "undefined") ? EMBEDDED_DATA : null;
let DRAW_DATA = normalize(RAW_DATA);

/* ---------------- 数据规范化 ---------------- */
function normalize(raw) {
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
  out.reverse(); // 接口最新在前 → 转为时间正序
  return out;
}

/* ---------------- 统计核心 ---------------- */
function computeStats(draws, windowSize) {
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

  const DECAY = 0.92; // 近期权重衰减因子
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
    const gap = hit.map(row => { // 当前遗漏：从最后一期往前连续未出期数
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

  return {
    windowSize: W,
    draws: win,
    red, blue,
    latest: win[W - 1],
    statsText: `窗口 ${W} 期：红球合计 ${red.reduce((a, r) => a + r.cnt, 0)} 次（理论均次 ${(6 * W / 33).toFixed(1)}），蓝球合计 ${blue.reduce((a, b) => a + b.cnt, 0)} 次`
  };
}

/* ---------------- 预测算法 ---------------- */
const PRESETS = {
  balanced: { label: "均衡混合", w: { freq: 0.40, rec: 0.30, gap: 0.30 } },
  cold:     { label: "冷号回补", w: { freq: 0.15, rec: 0.10, gap: 0.75 } },
  hot:      { label: "热号延续", w: { freq: 0.60, rec: 0.35, gap: 0.05 } }
};

function softmax(arr) {
  const m = Math.max(...arr);
  const ex = arr.map(x => Math.exp(x - m));
  const s = ex.reduce((a, x) => a + x, 0);
  return ex.map(x => x / s);
}

function predict(stats, presetKey) {
  const p = PRESETS[presetKey] || PRESETS.balanced;
  const score = (item, get) => item.map(it =>
    p.w.freq * it.zFreq + p.w.rec * it.rec + p.w.gap * it.ratioZ
  );
  const redP = softmax(score(stats.red));
  const blueP = softmax(score(stats.blue));
  const redOut = stats.red.map((r, i) => ({
    n: r.n, p: redP[i], exp: 6 * redP[i],
    zFreq: r.zFreq, zRec: r.rec, zGap: r.ratioZ
  })).sort((a, b) => b.p - a.p);
  const blueOut = stats.blue.map((b, i) => ({
    n: b.n, p: blueP[i],
    zFreq: b.zFreq, zRec: b.rec, zGap: b.ratioZ
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

function simulateWeighted(pool, k, weights) {
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

/* ---------------- 组合数学 ---------------- */
function cnk(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}

function* combos(arr, k) {
  if (k === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combos(arr.slice(i + 1), k - 1)) {
      yield [arr[i]].concat(rest);
    }
  }
}

/* ---------------- 选号生成 ---------------- */
function genRandom(n) {
  const nums = Array.from({ length: 33 }, (_, i) => i + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const red = simulateWeighted(nums, 6, nums.map(() => 1)).sort((a, b) => a - b);
    out.push({ red, blue: 1 + Math.floor(Math.random() * 16) });
  }
  return out;
}

function genDanTuo(dan, tuo, blues, opts) {
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

  // 随机抽取不重复组合
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

/* ---------------- DOM 工具 ---------------- */
const $ = id => document.getElementById(id);
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === "class") node.className = attrs[k];
    else if (k === "text") node.textContent = attrs[k];
    else if (k === "html") node.innerHTML = attrs[k];
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), attrs[k]);
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => node.appendChild(c));
  return node;
}

/* ---------------- 画布绘图 ---------------- */
function setupCanvas(canvas, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawBars(canvas, items, labelEvery, colors) {
  const { ctx, w, h } = setupCanvas(canvas, canvas.getAttribute("data-h") || 230);
  const pad = { t: 8, r: 4, b: 24, l: 36 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max.apply(null, items.map(i => i.val)) || 1;
  const n = items.length, bw = iw / n;
  ctx.strokeStyle = "#eef1f6"; ctx.fillStyle = "#9aa5b5"; ctx.font = "10px sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + ih - ih * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(String(Math.round(max * g / 4)), pad.l - 5, y);
  }
  items.forEach((it, i) => {
    const v = it.val / max;
    const x = pad.l + i * bw, y = pad.t + ih * (1 - v);
    const bw2 = bw * 0.72;
    ctx.fillStyle = colors ? colors[i] : "#b9c2d0";
    ctx.fillRect(x + bw / 2 - bw2 / 2, y, bw2, pad.t + ih - y);
    if (i % labelEvery === 0 || i === n - 1) {
      ctx.fillStyle = "#9aa5b5"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(String(it.n), x + bw / 2, h - 18);
    }
  });
  canvas._meta = { n, bw, padL: pad.l };
}

function drawLine(canvas, labels, values, color) {
  const { ctx, w, h } = setupCanvas(canvas, canvas.getAttribute("data-h") || 220);
  const pad = { t: 10, r: 10, b: 24, l: 36 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const min = Math.min.apply(null, values.concat([0]));
  const max = Math.max.apply(null, values.concat([1]));
  const span = (max - min) || 1;
  ctx.strokeStyle = "#eef1f6"; ctx.fillStyle = "#9aa5b5"; ctx.font = "10px sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + ih - ih * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText((max - span * g / 4).toFixed(1), pad.l - 5, y);
  }
  const X = i => pad.l + iw * i / (labels.length - 1 || 1);
  const Y = v => pad.t + ih * (1 - (v - min) / span);
  ctx.beginPath();
  values.forEach((v, i) => i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(X(labels.length - 1), pad.t + ih); ctx.lineTo(X(0), pad.t + ih); ctx.closePath();
  ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
  values.forEach((v, i) => {
    ctx.beginPath(); ctx.arc(X(i), Y(v), 2.4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  });
  ctx.fillStyle = "#9aa5b5"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  [0, Math.floor((labels.length - 1) / 2), labels.length - 1].forEach(i => {
    ctx.fillText(labels[i], X(i), h - 18);
  });
}

/* ---------------- 状态 ---------------- */
let STATS = null;
let SELECTED_RED = 0;
let LAST_PRED = null;

/* ---------------- 趋势页 ---------------- */
function renderTrend() {
  STATS = computeStats(DRAW_DATA, parseInt($("winSelect").value, 10));
  $("redStatInfo").textContent = STATS.statsText;
  $("blueStatInfo").textContent = STATS.statsText;
  renderRedBars();
  renderBlueBars();
  renderTables();
  renderHeat();
  selectRed(SELECTED_RED || STATS.red.reduce((best, r) => r.cnt > best.cnt ? r : best).n);
}

const STATUS_COLOR = { hot: "#d63b3b", warm: "#e8952f", cold: "#2f6fed" };
const STATUS_BADGE = { hot: "热", warm: "温", cold: "冷" };

function renderRedBars() {
  const c = $("redBars");
  drawBars(c, STATS.red.map(r => ({ n: r.n, val: r.cnt })), 4, STATS.red.map(r => STATUS_COLOR[r.status]));
  c.onclick = e => {
    if (!c._meta) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.floor((x - c._meta.padL) / c._meta.bw);
    if (idx >= 0 && idx < 33) selectRed(idx + 1);
  };
}

function renderBlueBars() {
  drawBars($("blueBars"), STATS.blue.map(b => ({ n: b.n, val: b.cnt })), 3,
    STATS.blue.map(b => STATUS_COLOR[b.status]));
}

function sortItems(list) {
  const key = $("sortSelect").value;
  const sorted = list.slice();
  if (key === "cnt") sorted.sort((a, b) => b.cnt - a.cnt);
  else if (key === "gap") sorted.sort((a, b) => b.gap - a.gap);
  else if (key === "maxgap") sorted.sort((a, b) => b.maxGap - a.maxGap);
  else sorted.sort((a, b) => b.freq - a.freq);
  return sorted;
}

function rowHtml(it, isRed, onPick) {
  const trend = it.trend === "up" ? '<span class="up">↑</span>'
    : it.trend === "down" ? '<span class="down">↓</span>' : '<span class="flat">→</span>';
  return el("tr", { class: isRed && SELECTED_RED === it.n ? "sel-row" : "" }, [
    el("td", { class: isRed ? "num" : "blue", text: String(it.n).padStart(2, "0") }),
    el("td", { text: String(it.cnt) }),
    el("td", { text: (it.freq * 100).toFixed(1) + "%" }),
    el("td", { text: String(it.last10) }),
    el("td", { text: String(it.gap) }),
    el("td", { text: String(it.maxGap) }),
    el("td", { text: it.avgGap > W_SAFE ? "—" : it.avgGap.toFixed(1) }),
    el("td", {}, [el("span", { class: "badge " + it.status, text: STATUS_BADGE[it.status] })]),
    el("td", { html: trend })
  ]);
}
const W_SAFE = 100000; // avgGap 兜底

function renderTables() {
  const redBody = $("redTableBody");
  const blueBody = $("blueTableBody");
  redBody.innerHTML = ""; blueBody.innerHTML = "";
  const sel = SELECTED_RED;
  sortItems(STATS.red).forEach(it => {
    const tr = rowHtml(it, true);
    tr.onclick = () => selectRed(it.n);
    redBody.appendChild(tr);
  });
  sortItems(STATS.blue).forEach(it => {
    blueBody.appendChild(rowHtml(it, false));
  });
  // 高亮当前选中行（排序后重设）
  redBody.querySelectorAll("tr").forEach(tr => {
    tr.classList.toggle("sel-row", tr.children[0] && parseInt(tr.children[0].textContent, 10) === sel);
  });
}

function renderHeat() {
  const R = parseInt($("heatSelect").value, 10);
  const rows = STATS.draws.slice(-R).reverse(); // 最新在上
  const redHeat = $("redHeat"), blueHeat = $("blueHeat");
  redHeat.innerHTML = ""; blueHeat.innerHTML = "";

  const head = el("div", { class: "heat-x" });
  for (let n = 1; n <= 33; n++) head.appendChild(el("span", { text: String(n % 10) }));
  redHeat.appendChild(head);
  const bhead = el("div", { class: "heat-x" });
  for (let n = 1; n <= 16; n++) bhead.appendChild(el("span", { text: String(n % 10) }));
  blueHeat.appendChild(bhead);

  rows.forEach(d => {
    const rrow = el("div", { class: "heat-row" }, [
      el("span", { class: "heat-label", text: d.issue.slice(-5) })
    ]);
    for (let n = 1; n <= 33; n++) {
      rrow.appendChild(el("div", {
        class: "heat-cell" + (d.red.includes(n) ? " on-red" : ""),
        title: `${d.issue} · ${String(n).padStart(2, "0")}`
      }));
    }
    redHeat.appendChild(rrow);
    const brow = el("div", { class: "heat-row" }, [
      el("span", { class: "heat-label", text: d.issue.slice(-5) })
    ]);
    for (let n = 1; n <= 16; n++) {
      brow.appendChild(el("div", {
        class: "heat-cell" + (d.blue === n ? " on-blue" : ""),
        title: `${d.issue} · 蓝${String(n).padStart(2, "0")}`
      }));
    }
    blueHeat.appendChild(brow);
  });
}

function selectRed(n) {
  SELECTED_RED = n;
  const it = STATS.red[n - 1];
  $("selTitle").textContent = `单号走势：红球 ${String(n).padStart(2, "0")}（滚动 10 期出现频率）`;
  $("selDetail").textContent =
    `次数 ${it.cnt} · 频率 ${(it.freq * 100).toFixed(1)}% · 状态 ${STATUS_BADGE[it.status]} · ` +
    `当前遗漏 ${it.gap} 期（最大 ${it.maxGap}）· 上次出现 ${it.lastIssue}`;
  const L = Math.min(40, STATS.windowSize);
  const labels = [], values = [];
  const base = STATS.windowSize - L;
  for (let i = 0; i < L; i++) {
    const slice = STATS.draws.slice(base + i - 9, base + i + 1);
    const cnt = slice.filter(d => d.red.includes(n)).length;
    labels.push(STATS.draws[base + i].issue.slice(-5));
    values.push(cnt / slice.length * 100);
  }
  drawLine($("lineChart"), labels, values, "#d63b3b");
  renderTables(); // 刷新选中行高亮
}

/* ---------------- 预测页 ---------------- */
function runPredict() {
  const key = document.querySelector('input[name="preset"]:checked').value;
  LAST_PRED = predict(STATS, key);
  $("predModelName").textContent = `模型：${LAST_PRED.model}`;
  const rec = LAST_PRED.rec;
  const recBox = $("predRec");
  recBox.innerHTML = "";
  rec.red.forEach(n => recBox.appendChild(el("span", { class: "chip", text: String(n).padStart(2, "0") })));
  recBox.appendChild(el("span", { class: "chip blue", text: String(rec.blue).padStart(2, "0") }));
  $("predBlueAlt").textContent = `蓝球备选：${rec.blueAlt.map(b => String(b).padStart(2, "0")).join("、")}`;

  const redBody = $("predRedBody"), blueBody = $("predBlueBody");
  redBody.innerHTML = ""; blueBody.innerHTML = "";
  LAST_PRED.red.forEach((x, i) => {
    redBody.appendChild(el("tr", {}, [
      el("td", { text: String(i + 1) }),
      el("td", { class: "num", text: String(x.n).padStart(2, "0") }),
      el("td", {}, [el("div", { class: "prob-cell" }, [
        el("div", { class: "prob-bar", style: `width:${Math.min(100, x.p * 420)}px` }),
        el("span", { class: "pval", text: (x.p * 100).toFixed(2) + "%" })
      ])]),
      el("td", { text: x.exp.toFixed(2) }),
      el("td", { html: sigHtml(x) })
    ]));
  });
  LAST_PRED.blue.forEach((x, i) => {
    blueBody.appendChild(el("tr", {}, [
      el("td", { text: String(i + 1) }),
      el("td", { class: "blue", text: String(x.n).padStart(2, "0") }),
      el("td", {}, [el("div", { class: "prob-cell" }, [
        el("div", { class: "prob-bar", style: `width:${Math.min(100, x.p * 160)}px` }),
        el("span", { class: "pval", text: (x.p * 100).toFixed(2) + "%" })
      ])]),
      el("td", { html: sigHtml(x) })
    ]));
  });
  $("predResult").classList.remove("hidden");
  $("btnPredSim").disabled = false;
}

function sigHtml(x) {
  const f = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);
  return `<span class="${x.zFreq >= 0 ? "up" : "down"}">频${f(x.zFreq)}</span> ` +
         `<span class="${x.zRec >= 0 ? "up" : "down"}">近${f(x.zRec)}</span> ` +
         `<span class="${x.zGap >= 0 ? "up" : "down"}">漏${f(x.zGap)}</span>`;
}

function runPredSim() {
  if (!LAST_PRED) return;
  const box = $("predSim");
  box.innerHTML = "";
  const redW = LAST_PRED.red.slice().sort((a, b) => a.n - b.n).map(x => x.p);
  const blueW = LAST_PRED.blue.slice().sort((a, b) => a.n - b.n).map(x => x.p);
  const nums = Array.from({ length: 33 }, (_, i) => i + 1);
  const blues = Array.from({ length: 16 }, (_, i) => i + 1);
  for (let i = 0; i < 10; i++) {
    const red = simulateWeighted(nums, 6, redW).sort((a, b) => a - b);
    const blue = simulateWeighted(blues, 1, blueW)[0];
    box.appendChild(comboRow(i + 1, red, blue));
  }
}

/* ---------------- 选号页 ---------------- */
function comboRow(idx, red, blue) {
  const row = el("div", { class: "combo" }, [el("b", { text: `第 ${idx} 注` })]);
  red.forEach(n => row.appendChild(el("span", { class: "chip", text: String(n).padStart(2, "0") })));
  row.appendChild(el("span", { class: "chip blue", text: String(blue).padStart(2, "0") }));
  return row;
}

function renderCombos(list, container, total) {
  container.innerHTML = "";
  const count = el("p", { class: "gen-count" });
  if (total != null) count.textContent = `共 ${total} 注，金额 ${(total * 2).toLocaleString()} 元`;
  container.appendChild(count);
  const MAX_SHOW = 300;
  list.slice(0, MAX_SHOW).forEach((c, i) => container.appendChild(comboRow(i + 1, c.red, c.blue)));
  if (list.length > MAX_SHOW) {
    container.appendChild(el("p", { class: "hint", text: `已显示前 ${MAX_SHOW} 注，共 ${list.length} 注` }));
  }
}

const sel = { dan: new Set(), tuo: new Set(), blue: new Set() };
let dtMode = "dan";

function buildNumberGrids() {
  const danGrid = $("danGrid");
  const blueGrid = $("blueGrid");
  danGrid.innerHTML = ""; blueGrid.innerHTML = "";
  for (let n = 1; n <= 33; n++) {
    const b = el("button", { class: "num", text: String(n).padStart(2, "0") });
    b.onclick = () => {
      if (dtMode === "dan") {
        if (sel.dan.has(n)) { sel.dan.delete(n); }
        else {
          if (sel.dan.size >= 5) { alert("胆码最多 5 个"); return; }
          sel.dan.add(n); sel.tuo.delete(n);
        }
      } else if (dtMode === "tuo") {
        if (sel.tuo.has(n)) { sel.tuo.delete(n); }
        else { sel.tuo.add(n); sel.dan.delete(n); }
      } else { // 蓝球模式误点红球：忽略
        return;
      }
      refreshGrids();
    };
    danGrid.appendChild(b);
  }
  for (let n = 1; n <= 16; n++) {
    const b = el("button", { class: "num", text: String(n).padStart(2, "0") });
    b.onclick = () => {
      if (sel.blue.has(n)) sel.blue.delete(n); else sel.blue.add(n);
      refreshGrids();
    };
    blueGrid.appendChild(b);
  }
}

function refreshGrids() {
  const nums = $("danGrid").children;
  for (let n = 1; n <= 33; n++) {
    nums[n - 1].className = "num" +
      (sel.dan.has(n) ? " dan" : sel.tuo.has(n) ? " tuo" : "");
  }
  const blues = $("blueGrid").children;
  for (let n = 1; n <= 16; n++) {
    blues[n - 1].className = "num" + (sel.blue.has(n) ? " blue-sel" : "");
  }
  updateDtSummary();
}

function updateDtSummary() {
  const dan = [...sel.dan].sort((a, b) => a - b);
  const tuo = [...sel.tuo].sort((a, b) => a - b);
  const blue = [...sel.blue].sort((a, b) => a - b);
  const box = $("dtSummary");
  let msg = `胆码 ${dan.length} 个：${dan.join("、") || "—"}　|　拖码 ${tuo.length} 个：${tuo.join("、") || "—"}　|　蓝球 ${blue.length} 个：${blue.join("、") || "—"}`;
  const d = dan.length, t = tuo.length, need = 6 - d;
  if (d >= 1 && d <= 5 && t >= need && blue.length >= 1) {
    const total = cnk(t, need) * blue.length;
    msg += `<br>可生成 <b>${total.toLocaleString()} 注</b>，金额 <b>${(total * 2).toLocaleString()} 元</b>`;
  } else {
    msg += `<br><span style="color:var(--red)">${d === 0 ? "请先选择 1–5 个胆码" : t < need ? `拖码还需 ${need - t} 个` : "请选择至少 1 个蓝球"}</span>`;
  }
  box.innerHTML = msg;
}

function doGenDanTuo(all) {
  const dan = [...sel.dan], tuo = [...sel.tuo], blues = [...sel.blue];
  const res = genDanTuo(dan, tuo, blues, all ? { all: true } : { n: parseInt($("dtSample").value, 10) || 5 });
  const box = $("dtResult");
  if (res.error) { box.innerHTML = ""; box.appendChild(el("p", { class: "hint", text: res.error })); return; }
  renderCombos(res.list, box, res.total);
  const dl = $("btnDtDownload");
  dl.classList.toggle("hidden", !all);
  if (all) dl.dataset.total = res.total;
}

function downloadTxt() {
  const dan = [...sel.dan], tuo = [...sel.tuo], blues = [...sel.blue];
  const need = 6 - dan.length;
  const lines = [];
  const cap = 100000;
  outer:
  for (const drag of combos(tuo, need)) {
    for (const bl of blues) {
      if (lines.length >= cap) break outer;
      const red = dan.concat(drag).sort((a, b) => a - b);
      lines.push(red.map(n => String(n).padStart(2, "0")).join(" ") + "  蓝 " + String(bl).padStart(2, "0"));
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "双色球胆拖组合.txt" });
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- 数据更新 ---------------- */
function updateHeader() {
  if (!DRAW_DATA.length) { $("dataCount").textContent = "0"; $("dataLatest").textContent = "—"; return; }
  const last = DRAW_DATA[DRAW_DATA.length - 1];
  $("dataCount").textContent = String(DRAW_DATA.length);
  $("dataLatest").textContent = `${last.issue} 期（${last.date}）`;
}

function toExportJSON() {
  return {
    state: 0, message: "双色球历史数据（双色球助手导出）", Tflag: 0,
    result: DRAW_DATA.slice().reverse().map(d => ({
      name: "双色球", code: d.issue, date: d.date,
      red: d.red.join(","), blue: String(d.blue).padStart(2, "0")
    }))
  };
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(toExportJSON())], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "双色球历史数据.json" });
  document.body.appendChild(a); a.click(); a.remove();
}

function importJSON(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { alert("JSON 解析失败：" + e.message); return; }
  const draws = normalize(parsed);
  if (draws.length < 10) { alert(`数据无效或不足 10 期（解析到 ${draws.length} 期）。请提供形如 {"result":[{...}]} 的数据，最新期在前。`); return; }
  DRAW_DATA = draws;
  updateHeader();
  renderTrend();
  $("importPanel").classList.add("hidden");
  $("importText").value = "";
  alert(`导入成功：${draws.length} 期（最新 ${draws[draws.length - 1].issue} 期）`);
}

/* ---------------- 数据源（按顺序自动降级） ----------------
 * 官方接口直连无 CORS 头，浏览器会拦截；GitHub raw 与 jsDelivr 均带
 * Access-Control-Allow-Origin: *，浏览器可直连，且数据每日更新。
 * 依次尝试，第一个成功即用。
 * ------------------------------------------------------------ */
function adaptGitHub(json) {
  // fetch_history/lottery_data.json 或 data/lottery_history.json 的 data 数组
  const list = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);
  return {
    result: list.map(d => ({
      code: String(d.period != null ? d.period : ""),
      date: d.date || "",
      red: (Array.isArray(d.red_balls) ? d.red_balls : String(d.red || "").split(",")).join(","),
      blue: Number(d.blue_ball != null ? d.blue_ball : d.blue)
    }))
  };
}

const DATA_SOURCES = [
  {
    name: "官方福彩接口（直连）",
    url: "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100",
    adapt: json => json
  },
  {
    name: "GitHub 镜像① raw",
    url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/fetch_history/lottery_data.json",
    adapt: adaptGitHub
  },
  {
    name: "GitHub 镜像② raw",
    url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/data/lottery_history.json",
    adapt: adaptGitHub
  },
  {
    name: "GitHub 镜像③ jsDelivr CDN",
    url: "https://cdn.jsdelivr.net/gh/sinyu1012/Double-Color-Ball-AI@main/fetch_history/lottery_data.json",
    adapt: adaptGitHub
  }
];

async function fetchSource(src, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(src.url, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOnline() {
  const btn = $("btnOnline");
  btn.disabled = true;
  const failures = [];
  for (let i = 0; i < DATA_SOURCES.length; i++) {
    const src = DATA_SOURCES[i];
    btn.textContent = `更新中（${i + 1}/${DATA_SOURCES.length}：${src.name.replace(/^GitHub /, "镜像")}）…`;
    try {
      const json = await fetchSource(src, 9000);
      const draws = normalize(src.adapt(json));
      if (draws.length < 10) throw new Error("有效数据不足（" + draws.length + " 期）");
      DRAW_DATA = draws;
      updateHeader();
      renderTrend();
      const last = draws[draws.length - 1];
      btn.disabled = false; btn.textContent = "在线更新";
      alert(`✅ 在线更新成功（来源：${src.name}）\n共 ${draws.length} 期，最新 ${last.issue} 期（${last.date}）`);
      return;
    } catch (e) {
      failures.push(`· ${src.name}：${e.message || e}`);
    }
  }
  btn.disabled = false; btn.textContent = "在线更新";
  alert("❌ 全部数据源尝试失败：\n\n" + failures.join("\n") +
    "\n\n解决办法（任选其一）：\n" +
    "1. 检查网络后重新点击「在线更新」；\n" +
    "2. 本机已装 Node.js 的话，运行插件目录里的「node update-data.mjs」一键更新（无浏览器限制）；\n" +
    "3. 点「导出数据」拿到 JSON → 用官方接口最新数据替换 → 再点「导入数据」粘贴。");
}

/* ---------------- 初始化 ---------------- */
function init() {
  updateHeader();
  buildNumberGrids();
  refreshGrids();

  // 标签页
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      $(b.dataset.tab).classList.add("active");
      if (b.dataset.tab === "tab-trend") renderTrend();
    };
  });

  // 趋势
  $("winSelect").onchange = renderTrend;
  $("sortSelect").onchange = renderTrend;
  $("heatSelect").onchange = renderHeat;

  // 预测
  $("btnPredict").onclick = runPredict;
  $("btnPredSim").onclick = runPredSim;

  // 随机
  $("btnRand").onclick = () => {
    const n = Math.max(1, Math.min(50, parseInt($("randCount").value, 10) || 5));
    const box = $("randResult");
    box.innerHTML = "";
    box.appendChild(el("p", { class: "gen-count", text: `共 ${n} 注，金额 ${(n * 2).toLocaleString()} 元（纯随机）` }));
    genRandom(n).forEach((c, i) => box.appendChild(comboRow(i + 1, c.red, c.blue)));
  };

  // 胆拖
  document.querySelectorAll('input[name="dtmode"]').forEach(r => {
    r.onchange = () => { dtMode = r.value; };
  });
  $("btnDtClear").onclick = () => { sel.dan.clear(); sel.tuo.clear(); sel.blue.clear(); refreshGrids(); $("dtResult").innerHTML = ""; $("btnDtDownload").classList.add("hidden"); };
  $("btnDtAll").onclick = () => doGenDanTuo(true);
  $("btnDtSample").onclick = () => doGenDanTuo(false);
  $("btnDtDownload").onclick = downloadTxt;

  // 数据
  $("btnExport").onclick = exportJSON;
  $("btnImport").onclick = () => $("importPanel").classList.toggle("hidden");
  $("btnImportClose").onclick = () => $("importPanel").classList.add("hidden");
  $("btnImportGo").onclick = () => importJSON($("importText").value);
  $("btnOnline").onclick = fetchOnline;

  renderTrend();
  if (!DRAW_DATA.length) alert("未内置历史数据，请点「导入数据」粘贴双色球历史 JSON。");
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

/* Node 测试导出 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalize, computeStats, predict, genDanTuo, genRandom, cnk, combos, simulateWeighted, softmax, adaptGitHub, DATA_SOURCES };
}
