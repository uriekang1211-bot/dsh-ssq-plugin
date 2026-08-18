// 逻辑自测：不依赖浏览器，直接验证统计/预测/组合算法
const path = require("node:path");
const raw = require("./history.json");
const lib = require("./src/app.js");

let failed = 0;
function check(name, cond, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  " + extra : ""));
  if (!cond) failed++;
}

// 1. 数据规范化
const draws = lib.normalize(raw);
check("解析出 100 期", draws.length === 100, `实际 ${draws.length}`);
check("时间正序（最旧在前）", draws[0].issue < draws[draws.length - 1].issue, `${draws[0].issue} -> ${draws[draws.length - 1].issue}`);
check("每期 6 红 1 蓝", draws.every(d => d.red.length === 6 && d.blue >= 1 && d.blue <= 16));
check("红球在 1-33 内", draws.every(d => d.red.every(n => n >= 1 && n <= 33)));

// 2. 统计：次数守恒
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

// 3. 预测：概率归一 + 期望次数守恒
for (const key of ["balanced", "cold", "hot"]) {
  const p = lib.predict(s, key);
  const sumRed = p.red.reduce((a, x) => a + x.p, 0);
  const sumBlue = p.blue.reduce((a, x) => a + x.p, 0);
  check(`预测[${key}] 红球概率和=1`, Math.abs(sumRed - 1) < 1e-9);
  check(`预测[${key}] 蓝球概率和=1`, Math.abs(sumBlue - 1) < 1e-9);
  check(`预测[${key}] 推荐=6红+1蓝`, p.rec.red.length === 6 && p.rec.red.every(n => n >= 1 && n <= 33) && p.rec.blue >= 1 && p.rec.blue <= 16);
  check(`预测[${key}] 红球期望次数和=6`, Math.abs(p.red.reduce((a, x) => a + x.exp, 0) - 6) < 1e-9);
}
console.log(`      均衡混合推荐: 红 [${lib.predict(s, "balanced").rec.red.join(",")}] 蓝 ${lib.predict(s, "balanced").rec.blue}`);
console.log(`      冷号回补推荐: 红 [${lib.predict(s, "cold").rec.red.join(",")}] 蓝 ${lib.predict(s, "cold").rec.blue}`);
console.log(`      热号延续推荐: 红 [${lib.predict(s, "hot").rec.red.join(",")}] 蓝 ${lib.predict(s, "hot").rec.blue}`);

// 4. 组合数学
check("C(5,2)=10", lib.cnk(5, 2) === 10);
check("C(33,6)=1107568", lib.cnk(33, 6) === 1107568, `实际 ${lib.cnk(33, 6)}`);
const comboCount = [...lib.combos([1, 2, 3, 4, 5], 2)].length;
check("组合枚举数量=10", comboCount === 10);

// 5. 胆拖生成
const r1 = lib.genDanTuo([1, 2], [3, 4, 5, 6, 7], [1, 2], { all: true });
check("胆拖 2胆5拖2蓝 → 全部 C(5,4)*2=10 注", r1.ok && r1.total === 10 && r1.list.length === 10, `实际 ${r1.total}`);
check("每注包含全部胆码", r1.list.every(c => c.red.includes(1) && c.red.includes(2)));
check("每注 6 红 1 蓝", r1.list.every(c => c.red.length === 6 && c.blue >= 1 && c.blue <= 2));
const r2 = lib.genDanTuo([1, 2], [3, 4, 5, 6, 7], [1, 2], { n: 5 });
check("胆拖抽样 5 注且不重复", r2.ok && r2.list.length === 5 && new Set(r2.list.map(c => c.red.join(",") + "|" + c.blue)).size === 5);
check("胆码超 5 报错", lib.genDanTuo([1,2,3,4,5,6], [7,8,9], [1]).error != null);
check("拖码不足报错", lib.genDanTuo([1,2,3,4,5], [], [1]).error != null);

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
check("数据源链含 4 个源且全部可解析格式", lib.DATA_SOURCES.length === 4 &&
  lib.DATA_SOURCES.every(s => typeof s.url === "string" && s.url.startsWith("http") && typeof s.adapt === "function"));

console.log(failed === 0 ? "\n全部通过 ✔" : `\n${failed} 项失败 ✘`);
process.exit(failed === 0 ? 0 : 1);
