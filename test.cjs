// 逻辑自测：不依赖浏览器，直接验证统计/预测/组合算法 + 浏览器版与插件版核心一致性
const path = require("node:path");
const raw = require("./history.json");
const lib = require("./src/app.cjs");

let failed = 0;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  " + extra : ""));
  if (!cond) failed++;
}

async function main() {
  // 1. 数据规范化
  const draws = lib.normalize(raw);
  check("解析出 1000 期", draws.length === 1000, `实际 ${draws.length}`);
  check("时间正序（最旧在前）", draws[0].issue < draws[draws.length - 1].issue, `${draws[0].issue} -> ${draws[draws.length - 1].issue}`);
  check("每期 6 红 1 蓝", draws.every(d => d.red.length === 6 && d.blue >= 1 && d.blue <= 16));
  check("红球在 1-33 内", draws.every(d => d.red.every(n => n >= 1 && n <= 33)));

  // 2. 统计：次数守恒（100 期窗口）
  const s = lib.computeStats(draws, 100);
  const redSum = s.red.reduce((a, r) => a + r.cnt, 0);
  const blueSum = s.blue.reduce((a, b) => a + b.cnt, 0);
  check("红球总次数 = 600", redSum === 600, `实际 ${redSum}`);
  check("蓝球总次数 = 100", blueSum === 100, `实际 ${blueSum}`);
  check("红球频率之和 = 1", Math.abs(s.red.reduce((a, r) => a + r.freq, 0) - 1) < 1e-9);
  const hot = s.red.filter(r => r.status === "hot").length;
  const cold = s.red.filter(r => r.status === "cold").length;
  console.log(`      热度分布: 热 ${hot} / 温 ${33 - hot - cold} / 冷 ${cold}`);
  check("遗漏为非负整数", s.red.every(r => r.gap >= 0 && Number.isInteger(r.gap)));

  // 2b. 统计：千期窗口（默认窗口 1000）
  const s1k = lib.computeStats(draws, 1000);
  check("千期窗口红球总次数 = 6000", s1k.red.reduce((a, r) => a + r.cnt, 0) === 6000, `实际 ${s1k.red.reduce((a, r) => a + r.cnt, 0)}`);
  check("千期窗口蓝球总次数 = 1000", s1k.blue.reduce((a, b) => a + b.cnt, 0) === 1000);
  check("千期窗口频率之和 = 1", Math.abs(s1k.red.reduce((a, r) => a + r.freq, 0) - 1) < 1e-9);
  const p1k = lib.predict(s1k, "balanced");
  check("千期预测推荐 = 6红+1蓝", p1k.rec.red.length === 6 && p1k.rec.red.every(n => n >= 1 && n <= 33) && p1k.rec.blue >= 1 && p1k.rec.blue <= 16);

  // 3. 预测：概率归一 + 期望次数守恒
  for (const key of ["balanced", "cold", "hot"]) {
    const p = lib.predict(s, key);
    check(`预测[${key}] 红球概率和=1`, Math.abs(p.red.reduce((a, x) => a + x.p, 0) - 1) < 1e-9);
    check(`预测[${key}] 蓝球概率和=1`, Math.abs(p.blue.reduce((a, x) => a + x.p, 0) - 1) < 1e-9);
    check(`预测[${key}] 推荐=6红+1蓝`, p.rec.red.length === 6 && p.rec.red.every(n => n >= 1 && n <= 33) && p.rec.blue >= 1 && p.rec.blue <= 16);
    check(`预测[${key}] 红球期望次数和=6`, Math.abs(p.red.reduce((a, x) => a + x.exp, 0) - 6) < 1e-9);
  }
  console.log(`      均衡混合推荐: 红 [${lib.predict(s, "balanced").rec.red.join(",")}] 蓝 ${lib.predict(s, "balanced").rec.blue}`);

  // 3b. 新模型预设：EWMA / 遗漏均值回归 / 期望偏差回补
  for (const key of ["ewma", "miss", "expect"]) {
    const p = lib.predict(s, key);
    check(`预测[${key}] 红球概率和=1`, Math.abs(p.red.reduce((a, x) => a + x.p, 0) - 1) < 1e-9);
    check(`预测[${key}] 推荐=6红+1蓝`, p.rec.red.length === 6 && p.rec.red.every(n => n >= 1 && n <= 33) && p.rec.blue >= 1 && p.rec.blue <= 16);
  }
  const pe = lib.predict(s, "ewma");
  check("EWMA 模型输出 zEwma 信号", pe.red.every(x => typeof x.zEwma === "number") && pe.red.some(x => x.zEwma !== 0));
  const pm = lib.predict(s, "miss");
  const pmCold = lib.predict(s, "cold");
  check("遗漏均值回归与冷号回补 Top6 重合度高", pm.rec.red.filter(n => pmCold.rec.red.includes(n)).length >= 3);

  // 3c. 集成投票
  const en = lib.ensemble(s);
  check("集成投票含 6 个模型", en.presetKeys.length === 6 && en.model === "集成投票");
  check("集成投票推荐=6红+1蓝", en.rec.red.length === 6 && en.rec.red.every(n => n >= 1 && n <= 33) && en.rec.blue >= 1 && en.rec.blue <= 16);
  check("集成投票得票数合法", en.red.every(x => x.votes >= 1 && x.votes <= 6) && en.blue.every(x => x.votes >= 1 && x.votes <= 6));
  check("集成投票按票数降序", en.red.every((x, i) => i === 0 || en.red[i - 1].votes >= x.votes));

  // 3d. 组合结构统计
  const ss = lib.structureStats(draws, 1000);
  const sumFreq = (arr) => Math.abs(arr.reduce((a, x) => a + x.freq, 0) - 1) < 1e-6;
  check("结构统计 4 类频率和=1", sumFreq(ss.oddEven) && sumFreq(ss.size) && sumFreq(ss.zone) && sumFreq(ss.sum));
  check("结构统计 Top1 存在且计数合理", ss.oddEven.length > 0 && ss.oddEven[0].cnt >= 1 && /^\d+:\d+$/.test(ss.oddEven[0].key));
  const combos = lib.genStructureCombos({ oddEven: ss.oddEven[0].key, size: ss.size[0].key, zone: ss.zone[0].key }, 5);
  check("结构选号 5 注且符合约束", combos.length === 5 && combos.every(c => {
    const oe = ss.oddEven[0].key.split(":").map(Number);
    const sz = ss.size[0].key.split(":").map(Number);
    return c.red.length === 6 && c.red.filter(v => v % 2 === 1).length === oe[0] &&
      c.red.filter(v => v <= 16).length === sz[0] && c.blue >= 1 && c.blue <= 16;
  }));

  // 4. 组合数学
  check("C(5,2)=10", lib.cnk(5, 2) === 10);
  check("C(33,6)=1107568", lib.cnk(33, 6) === 1107568, `实际 ${lib.cnk(33, 6)}`);
  check("组合枚举数量=10", [...lib.combos([1, 2, 3, 4, 5], 2)].length === 10);

  // 5. 胆拖生成
  const r1 = lib.genDanTuo([1, 2], [3, 4, 5, 6, 7], [1, 2], { all: true });
  check("胆拖 2胆5拖2蓝 → 全部 C(5,4)*2=10 注", r1.ok && r1.total === 10 && r1.list.length === 10, `实际 ${r1.total}`);
  check("每注包含全部胆码", r1.list.every(c => c.red.includes(1) && c.red.includes(2)));
  check("每注 6 红 1 蓝", r1.list.every(c => c.red.length === 6 && c.blue >= 1 && c.blue <= 2));
  const r2 = lib.genDanTuo([1, 2], [3, 4, 5, 6, 7], [1, 2], { n: 5 });
  check("胆拖抽样 5 注且不重复", r2.ok && r2.list.length === 5 && new Set(r2.list.map(c => c.red.join(",") + "|" + c.blue)).size === 5);
  check("胆码超 5 报错", lib.genDanTuo([1, 2, 3, 4, 5, 6], [7, 8, 9], [1]).error != null);
  check("拖码不足报错", lib.genDanTuo([1, 2, 3, 4, 5], [], [1]).error != null);

  // 6. 随机生成
  const rr = lib.genRandom(20);
  check("随机 20 注均合法", rr.length === 20 && rr.every(c => c.red.length === 6 && new Set(c.red).size === 6 && c.blue >= 1 && c.blue <= 16));

  // 7. 数据源适配（GitHub 镜像格式）
  const ghSample = [
    { period: "26094", red_balls: ["06", "13", "15", "17", "24", "25"], blue_ball: "01", date: "2026-08-16" },
    { period: "26093", red_balls: ["05", "08", "15", "20", "21", "24"], blue_ball: "09", date: "2026-08-13" }
  ];
  const ghCwl = lib.adaptGitHub(ghSample);
  const ghDraws = lib.normalize(ghCwl);
  check("GitHub 镜像适配为 cwl 格式", ghCwl.result.length === 2 && ghCwl.result[0].code === "26094" && ghCwl.result[0].red === "06,13,15,17,24,25" && ghCwl.result[0].blue === 1);
  check("GitHub 数据可正常解析", ghDraws.length === 2 && ghDraws[0].red.length === 6 && ghDraws[0].blue === 9);
  check("数据源链含 5 个源（官方增量/全量 + 3 镜像）", lib.DATA_SOURCES.length === 5 &&
    lib.DATA_SOURCES.every(s => typeof s.url === "string" && s.url.startsWith("http") && typeof s.adapt === "function"));

  // 8. 浏览器版（src/app.js）与插件版（lib/ssq-core.js）核心一致性
  const coreESM = await import("./lib/ssq-core.js");
  const drawsB = coreESM.normalize(raw);
  check("ESM 版 normalize 与浏览器版一致", JSON.stringify(draws) === JSON.stringify(drawsB));
  const sb = coreESM.computeStats(drawsB, 100);
  check("ESM 版红球次数与浏览器版一致",
    JSON.stringify(s.red.map(r => r.cnt)) === JSON.stringify(sb.red.map(r => r.cnt)));
  check("ESM 版蓝球次数与浏览器版一致",
    JSON.stringify(s.blue.map(b => b.cnt)) === JSON.stringify(sb.blue.map(b => b.cnt)));
  check("ESM 版状态与浏览器版一致",
    JSON.stringify(s.red.map(r => r.status)) === JSON.stringify(sb.red.map(r => r.status)) &&
    JSON.stringify(s.red.map(r => r.gap)) === JSON.stringify(sb.red.map(r => r.gap)));
  const pb = coreESM.predict(sb, "balanced");
  check("ESM 版预测推荐与浏览器版一致",
    lib.predict(s, "balanced").rec.red.join(",") === pb.rec.red.join(",") &&
    lib.predict(s, "balanced").rec.blue === pb.rec.blue);
  check("ESM 版胆拖全部组合与浏览器版一致",
    JSON.stringify(coreESM.genDanTuo([1, 2], [3, 4, 5, 6, 7], [1, 2], { all: true }).list) === JSON.stringify(r1.list));
  // 新模型两版一致性
  for (const key of ["ewma", "miss", "expect"]) {
    check(`ESM 版预测[${key}]推荐与浏览器版一致`,
      coreESM.predict(sb, key).rec.red.join(",") === lib.predict(s, key).rec.red.join(",") &&
      coreESM.predict(sb, key).rec.blue === lib.predict(s, key).rec.blue);
  }
  const enB = lib.ensemble(s), enE = coreESM.ensemble(sb);
  check("ESM 版集成投票与浏览器版一致",
    enB.rec.red.join(",") === enE.rec.red.join(",") && enB.rec.blue === enE.rec.blue &&
    JSON.stringify(enB.red.map(x => [x.n, x.votes])) === JSON.stringify(enE.red.map(x => [x.n, x.votes])));
  const ssB = lib.structureStats(draws, 1000), ssE = coreESM.structureStats(drawsB, 1000);
  check("ESM 版结构统计与浏览器版一致",
    JSON.stringify(ssB.oddEven) === JSON.stringify(ssE.oddEven) &&
    JSON.stringify(ssB.size) === JSON.stringify(ssE.size) &&
    JSON.stringify(ssB.zone) === JSON.stringify(ssE.zone) &&
    JSON.stringify(ssB.sum) === JSON.stringify(ssE.sum));
  check("ESM 版 PRESETS 与浏览器版一致", Object.keys(coreESM.PRESETS).join(",") === Object.keys(lib.PRESETS).join(","));

  // 8b. 增量合并 mergeDraws（浏览器版与插件版一致 + 行为校验）
  const mk = (issue, red = [1, 2, 3, 4, 5, 6], blue = 1) => ({ issue, date: "2026-08-01", red, blue });
  const base5 = [mk("2026080"), mk("2026081"), mk("2026082"), mk("2026083"), mk("2026084")];
  const fresh2 = [mk("2026083"), mk("2026084"), mk("2026085"), mk("2026086")]; // 2 期重复 + 2 期新增
  const m1 = lib.mergeDraws(base5, fresh2);
  check("merge 去重合并且新增数=2", m1.addedCount === 2 && m1.draws.length === 7 &&
    m1.draws[0].issue === "2026080" && m1.draws[6].issue === "2026086");
  check("merge 连续期号无缺口", m1.hasGap === false);
  const m2 = lib.mergeDraws([mk("2026080"), mk("2026082")], [mk("2026083")]); // 中间缺 2026081
  check("merge 检测到缺口", m2.hasGap === true);
  const m3 = lib.mergeDraws([mk("2025345")], [mk("2026001")]); // 跨年衔接
  check("merge 跨年衔接视为连续", m3.hasGap === false);
  const m4 = lib.mergeDraws(base5, [], 3);
  check("merge 截取最近 max 期", m4.draws.length === 3 && m4.draws[2].issue === "2026084" && m4.addedCount === 0);
  const coreM = coreESM.mergeDraws(base5, fresh2);
  check("ESM 版 mergeDraws 与浏览器版一致", JSON.stringify(m1) === JSON.stringify(coreM));
  const esmMerge = coreESM.mergeDraws(drawsB, drawsB.slice(-5));
  check("千期基线增量合并后仍为 1000 期", esmMerge.draws.length === 1000 && esmMerge.addedCount === 0 && esmMerge.hasGap === false);
  check("插件包元数据完整", require("./package.json").name === "dsh-ssq-plugin" &&
    require("./package.json").dsh?.bundle?.patch === "./cordis.patch.yml" &&
    require("./package.json").main === "lib/index.js");

  // 9. 插件模块端到端冒烟（模拟 cordis 加载 + 工具调用，stub 网络）
  const plugin = await import("./lib/index.js");
  check("插件导出 name/inject/apply", plugin.name === "ssq" &&
    JSON.stringify(plugin.inject) === JSON.stringify(["tools"]) && typeof plugin.apply === "function");
  let registered = null;
  const stubCtx = { tools: { register: t => { registered = t; } } };
  plugin.apply(stubCtx);
  check("工具已注册且名为 ssq", registered != null && registered.name === "ssq");
  check("工具参数含 action 枚举", registered.parameters.properties.action.enum.join(",") === "trend,predict,ensemble,structure,generate" &&
    (registered.parameters.required || []).includes("action"));
  check("工具参数含 6 个模型预设", registered.parameters.properties.preset.enum.join(",") === "balanced,cold,hot,ewma,miss,expect");
  check("工具输出 schema 完整", registered.output.schema.required.join(",") === "ok,message,detail");

  const bundledRaw = require("./history.json");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => bundledRaw });
  try {
    const t1 = await registered.execute({ action: "trend", window: 100 });
    check("tool trend 正常返回", t1.ok === true && /趋势统计/.test(t1.message) && t1.detail.startsWith("{"));
    const t2 = await registered.execute({ action: "predict", preset: "cold" });
    check("tool predict 正常返回", t2.ok === true && /推荐号码/.test(t2.message));
    const t2d = JSON.parse(t2.detail);
    check("tool predict 默认基于最近 1000 期", /基于最近 1000 期/.test(t2.message) && t2d.window === 1000 && t2d.first && t2d.last);
    const t2b = await registered.execute({ action: "predict", preset: "hot", window: 500 });
    const t2bd = JSON.parse(t2b.detail);
    check("tool predict 可选 500 期数据范围", /基于最近 500 期/.test(t2b.message) && t2bd.window === 500 && t2bd.first !== t2bd.last);
    const t2c = await registered.execute({ action: "predict", preset: "balanced", window: 100 });
    check("tool predict 可选 100 期数据范围", /基于最近 100 期/.test(t2c.message) && JSON.parse(t2c.detail).window === 100);
    check("tool predict 输出含预测数据范围字段", typeof t2d.first === "string" && typeof t2d.last === "string");
    const t2e = await registered.execute({ action: "predict", preset: "ewma" });
    check("tool predict 支持 ewma 模型", t2e.ok === true && /EWMA 近期加权/.test(t2e.message));
    const t2f = await registered.execute({ action: "predict", preset: "miss" });
    check("tool predict 支持 miss 模型", t2f.ok === true && /遗漏均值回归/.test(t2f.message));
    const t2g = await registered.execute({ action: "predict", preset: "expect" });
    check("tool predict 支持 expect 模型", t2g.ok === true && /期望偏差回补/.test(t2g.message));
    const t2h = await registered.execute({ action: "ensemble" });
    check("tool ensemble 正常返回", t2h.ok === true && /集成投票/.test(t2h.message) && JSON.parse(t2h.detail).red[0].votes >= 1);
    const t2i = await registered.execute({ action: "structure", window: 500 });
    check("tool structure 正常返回", t2i.ok === true && /组合结构预测/.test(t2i.message) && JSON.parse(t2i.detail).combos.length === 5);
    const t3 = await registered.execute({ action: "generate", mode: "random", count: 3 });
    const t3d = JSON.parse(t3.detail);
    check("tool random 生成 3 注", t3.ok === true && t3d.combos.length === 3);
    const t4 = await registered.execute({ action: "generate", mode: "dantuo", dan: [1, 2], tuo: [3, 4, 5, 6, 7], blues: [1, 2], count: 3 });
    const t4d = JSON.parse(t4.detail);
    check("tool dantuo 正常返回", t4.ok === true && t4d.total === 10 && t4d.combos.length === 3);
    const t5 = await registered.execute({ action: "generate", mode: "dantuo", dan: [], tuo: [3], blues: [] });
    check("tool 参数错误优雅返回", t5.ok === false && /参数错误/.test(t5.message));
    let threwArgs = false;
    try { await registered.execute({ action: "bogus" }); } catch (e) { threwArgs = e && e.code === "INVALID_ARGS"; }
    check("tool 未知 action 被 schema 拒绝", threwArgs);
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log(failed === 0 ? "\n全部通过 ✔" : `\n${failed} 项失败 ✘`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
