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
  check("数据源链含 4 个源", lib.DATA_SOURCES.length === 4 &&
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
  check("工具参数含 action 枚举", registered.parameters.properties.action.enum.join(",") === "trend,predict,generate" &&
    (registered.parameters.required || []).includes("action"));
  check("工具输出 schema 完整", registered.output.schema.required.join(",") === "ok,message,detail");

  const bundledRaw = require("./history.json");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => bundledRaw });
  try {
    const t1 = await registered.execute({ action: "trend", window: 100 });
    check("tool trend 正常返回", t1.ok === true && /趋势统计/.test(t1.message) && t1.detail.startsWith("{"));
    const t2 = await registered.execute({ action: "predict", preset: "cold" });
    check("tool predict 正常返回", t2.ok === true && /推荐号码/.test(t2.message));
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
