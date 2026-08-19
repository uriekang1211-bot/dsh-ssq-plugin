// 本机一键更新脚本（无浏览器 CORS 限制）
// 用法：cd ssq-plugin && node update-data.mjs
// 作用：从官方接口 / GitHub 每日镜像拉取最近 1000 期双色球数据 → 更新 history.json → 重建 dist/index.html
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/* ---------- 数据规范化（与页面内 normalize 等价） ---------- */
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
    out.push({ issue: String(d.code != null ? d.code : (d.issue || "")), date: String(d.date || "").replace(/\(.*\)$/, ""), red, blue });
  }
  out.reverse(); // 接口最新在前 → 转时间正序
  return out;
}

/* ---------- 数据源 ---------- */
function adaptGitHub(json) {
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

const SOURCES = [
  {
    name: "官方福彩接口",
    url: "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=1000",
    adapt: j => j,
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36", "Referer": "https://www.cwl.gov.cn/", "Accept": "application/json" }
  },
  { name: "GitHub 镜像① raw", url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/fetch_history/lottery_data.json", adapt: adaptGitHub },
  { name: "GitHub 镜像② raw", url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/data/lottery_history.json", adapt: adaptGitHub },
  { name: "GitHub 镜像③ jsDelivr", url: "https://cdn.jsdelivr.net/gh/sinyu1012/Double-Color-Ball-AI@main/fetch_history/lottery_data.json", adapt: adaptGitHub }
];

async function main() {
  console.log("== 双色球数据一键更新 ==");
  let cwl = null, used = "", usedCount = 0;
  for (const s of SOURCES) {
    process.stdout.write(`尝试 ${s.name} ... `);
    try {
      const resp = await fetch(s.url, { headers: s.headers || { "Accept": "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      const draws = normalize(s.adapt(json));
      if (draws.length < 10) throw new Error("有效数据不足(" + draws.length + "期)");
      cwl = s.adapt(json);
      used = s.name;
      usedCount = draws.length;
      console.log(`成功（${draws.length} 期，${draws[0].issue} ~ ${draws[draws.length - 1].issue}，最新 ${draws[draws.length - 1].issue}）`);
      break;
    } catch (e) {
      console.log("失败 - " + e.message);
    }
  }
  if (!cwl) {
    console.error("\n❌ 所有数据源均失败，请检查网络后重试。");
    process.exit(1);
  }

  writeFileSync(join(root, "history.json"), JSON.stringify(cwl));
  console.log(`✔ 已写入 history.json（来源：${used}，${usedCount} 期）`);

  // 重建 dist/index.html
  await import("./build.mjs");
  console.log("✔ 已重建 dist/index.html，重新打开即可使用新数据。");
}

main().catch(e => { console.error("出错：", e); process.exit(1); });
