/* ============================================================
 * dsh-ssq-plugin — DSH Host 插件
 * 注册一个模型可调用的动态工具 `ssq`：
 *   - action=trend    千期趋势统计（次数/频率/遗漏/热度）
 *   - action=predict  频率+近期+遗漏回补 加权模型预测下一期
 *   - action=generate 胆拖规则 / 纯随机生成号码
 * 数据优先在线拉取最近 1000 期（官方接口 → GitHub 镜像 → CDN），
 * 失败时回退内置快照。开奖为独立随机事件，结果仅供娱乐参考。
 * ============================================================ */
import { readFileSync } from "node:fs";
import { defineTool } from "@deepseek-ai/dsh-tools";
import * as core from "./ssq-core.js";

export const name = "ssq";
export const inject = ["tools"];

const pad = n => String(n).padStart(2, "0");

/* ---------------- 数据加载 ---------------- */
const BUNDLED_RAW = JSON.parse(
  readFileSync(new URL("../data/ssq-history.json", import.meta.url), "utf8")
);

function adaptGithub(json) {
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
    name: "官方福彩接口",
    url: "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=1000",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Referer": "https://www.cwl.gov.cn/",
      "Accept": "application/json"
    }
  },
  {
    name: "GitHub 镜像①",
    url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/fetch_history/lottery_data.json",
    adapt: adaptGithub
  },
  {
    name: "GitHub 镜像②",
    url: "https://raw.githubusercontent.com/sinyu1012/Double-Color-Ball-AI/main/data/lottery_history.json",
    adapt: adaptGithub
  },
  {
    name: "jsDelivr CDN",
    url: "https://cdn.jsdelivr.net/gh/sinyu1012/Double-Color-Ball-AI@main/fetch_history/lottery_data.json",
    adapt: adaptGithub
  }
];

let cache = { at: 0, draws: null, source: "" };

async function loadDraws() {
  if (cache.draws && Date.now() - cache.at < 30 * 60 * 1000) return cache;
  for (const s of DATA_SOURCES) {
    try {
      const resp = await fetch(s.url, {
        headers: s.headers || { "Accept": "application/json" },
        signal: AbortSignal.timeout(9000)
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      const draws = core.normalize(s.adapt ? s.adapt(json) : json);
      if (draws.length < 10) throw new Error("有效数据不足(" + draws.length + "期)");
      cache = { at: Date.now(), draws, source: s.name };
      return cache;
    } catch (e) { /* 尝试下一源 */ }
  }
  const draws = core.normalize(BUNDLED_RAW);
  return { at: 0, draws, source: "内置快照（在线源暂不可达）" };
}

/* ---------------- 结果构造 ---------------- */
function srcNote(src) {
  const last = src.draws[src.draws.length - 1];
  return `（数据源：${src.source}｜最新 ${last.issue} 期 ${last.date}）`;
}

function buildTrend(draws, windowSize) {
  const s = core.computeStats(draws, windowSize);
  const hot = s.red.filter(r => r.status === "hot").sort((a, b) => b.cnt - a.cnt).slice(0, 8);
  const cold = s.red.filter(r => r.status === "cold").sort((a, b) => a.cnt - b.cnt).slice(0, 8);
  const overdue = s.red.slice().sort((a, b) => b.gap - a.gap).slice(0, 8);
  const blueTop = s.blue.slice().sort((a, b) => b.cnt - a.cnt).slice(0, 5);
  const first = s.draws[0].issue, last = s.draws[s.windowSize - 1].issue;
  const lines = [
    `【趋势统计】窗口：最近 ${s.windowSize} 期（${first} ~ ${last}）`,
    `红球热号（次数高）：${hot.map(r => pad(r.n) + "(" + r.cnt + "次)").join("、") || "无"}`,
    `红球冷号（次数低）：${cold.map(r => pad(r.n) + "(" + r.cnt + "次)").join("、") || "无"}`,
    `当前遗漏最多：${overdue.map(r => pad(r.n) + "(" + r.gap + "期)").join("、")}`,
    `蓝球出现次数 Top5：${blueTop.map(b => pad(b.n) + "(" + b.cnt + "次)").join("、")}`
  ];
  const row = r => ({ n: r.n, cnt: r.cnt, freq: +r.freq.toFixed(4), last10: r.last10, gap: r.gap, maxGap: r.maxGap, avgGap: +r.avgGap.toFixed(1), status: r.status, trend: r.trend, lastIssue: r.lastIssue });
  return {
    ok: true,
    message: lines.join("\n"),
    detail: JSON.stringify({ window: s.windowSize, first, last, red: s.red.map(row), blue: s.blue.map(row) })
  };
}

function buildPredict(draws, windowSize, presetKey) {
  const s = core.computeStats(draws, windowSize);
  const p = core.predict(s, presetKey);
  const lines = [
    `【预测下一期】模型：${p.model}（窗口 ${s.windowSize} 期）`,
    `推荐号码：红 ${p.rec.red.map(pad).join(" ")} ｜ 蓝 ${pad(p.rec.blue)}`,
    `蓝球备选：${p.rec.blueAlt.map(pad).join("、")}`,
    `红球概率 Top5：${p.red.slice(0, 5).map(x => pad(x.n) + "(" + (x.p * 100).toFixed(1) + "%)").join("、")}`,
    `⚠️ 开奖为独立随机事件，预测仅作娱乐参考，请理性购彩。`
  ];
  const redRow = x => ({ n: x.n, p: +x.p.toFixed(4), exp: +x.exp.toFixed(3), zFreq: +x.zFreq.toFixed(2), zRec: +x.zRec.toFixed(2), zGap: +x.zGap.toFixed(2) });
  return {
    ok: true,
    message: lines.join("\n"),
    detail: JSON.stringify({ model: p.model, rec: p.rec, red: p.red.map(redRow), blue: p.blue.map(x => ({ n: x.n, p: +x.p.toFixed(4), zFreq: +x.zFreq.toFixed(2), zRec: +x.zRec.toFixed(2), zGap: +x.zGap.toFixed(2) })) })
  };
}

function buildGenerate(args) {
  const fmt = c => `${c.red.map(pad).join(" ")} + 蓝 ${pad(c.blue)}`;
  if (args.mode === "dantuo") {
    const dan = (Array.isArray(args.dan) ? args.dan : []).map(Number).filter(n => n >= 1 && n <= 33);
    const tuo = (Array.isArray(args.tuo) ? args.tuo : []).map(Number).filter(n => n >= 1 && n <= 33);
    const blues = (Array.isArray(args.blues) ? args.blues : []).map(Number).filter(n => n >= 1 && n <= 16);
    const res = core.genDanTuo(dan, tuo, blues, { all: false, n: Math.max(1, Math.min(100, args.count || 5)) });
    if (res.error) return { ok: false, message: `【胆拖生成】参数错误：${res.error}`, detail: "" };
    const show = res.list.slice(0, 20);
    const lines = [
      `【胆拖生成】胆码 ${dan.length} 个：${dan.map(pad).join("、") || "—"}｜拖码 ${tuo.length} 个｜蓝球 ${blues.map(pad).join("、")}`,
      `共 ${res.total.toLocaleString()} 注（每注 2 元，共 ${(res.total * 2).toLocaleString()} 元），随机抽取 ${res.list.length} 注：`
    ];
    show.forEach((c, i) => lines.push(`${i + 1}. ${fmt(c)}`));
    if (res.list.length > show.length) lines.push(`…（其余 ${res.list.length - show.length} 注见 detail 字段）`);
    return {
      ok: true,
      message: lines.join("\n"),
      detail: JSON.stringify({ total: res.total, combos: res.list.map(c => ({ red: c.red, blue: c.blue })) })
    };
  }
  const n = Math.max(1, Math.min(50, args.count || 5));
  const combos = core.genRandom(n);
  const lines = [`【纯随机】${n} 注（每注 2 元，共 ${(n * 2).toLocaleString()} 元）：`];
  combos.forEach((c, i) => lines.push(`${i + 1}. ${fmt(c)}`));
  return { ok: true, message: lines.join("\n"), detail: JSON.stringify({ combos }) };
}

/* ---------------- 工具注册 ---------------- */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "ssq",
    description: "双色球（中国福利彩票）分析助手，基于最近 1000 期开奖数据。action=trend：统计最近 N 期（默认 1000 期）每个红球 1-33 / 蓝球 1-16 号码的出现次数、频率、遗漏与热温冷状态；action=predict：基于频率+近期衰减+遗漏回补加权模型预测下一期号码概率并给出推荐；action=generate：按胆拖规则（dan 胆码 1-5 个 + tuo 拖码 + blues 蓝球）或纯随机生成号码。开奖为独立随机事件，结果仅供娱乐参考。",
    timeoutMs: 30000,
    parameters: {
      action: {
        type: "string", required: true,
        description: "要执行的操作：trend=趋势统计（最近 10-1000 期，默认 1000）；predict=预测下一期；generate=生成号码",
        enum: ["trend", "predict", "generate"]
      },
      window: { type: "integer", description: "统计窗口期数，10-1000，默认 1000（trend/predict 使用）" },
      preset: {
        type: "string",
        description: "预测模型：balanced=均衡混合（默认）；cold=冷号回补；hot=热号延续",
        enum: ["balanced", "cold", "hot"]
      },
      mode: {
        type: "string",
        description: "生成方式：random=纯随机（默认）；dantuo=胆拖",
        enum: ["random", "dantuo"]
      },
      count: { type: "integer", description: "生成注数：random 时 1-50 默认 5；dantuo 时随机抽取注数 1-100 默认 5" },
      dan: { type: "array", description: "胆拖：胆码数组（1-5 个，范围 1-33，每注必中）", items: { type: "integer" } },
      tuo: { type: "array", description: "胆拖：拖码数组（至少 6-胆码数 个，范围 1-33）", items: { type: "integer" } },
      blues: { type: "array", description: "胆拖：蓝球数组（1 个及以上，范围 1-16）", items: { type: "integer" } }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          message: { type: "string", required: true },
          detail: { type: "string", required: true }
        }
      },
      render: (_args, value) => [{ type: "text", text: (value && value.message) ? value.message : String(value) }]
    },
    presentCall: (args) => ({ card: "generic", title: "双色球助手", kind: "other", rawInput: args }),
    async execute(args) {
      try {
        if (args.action === "generate") return buildGenerate(args);
        const src = await loadDraws();
        if (args.action === "trend") {
          const r = buildTrend(src.draws, Math.max(10, Math.min(1000, args.window || 1000)));
          r.message += "\n" + srcNote(src);
          return r;
        }
        if (args.action === "predict") {
          const r = buildPredict(src.draws, Math.max(10, Math.min(1000, args.window || 1000)), args.preset || "balanced");
          r.message += "\n" + srcNote(src);
          return r;
        }
        return { ok: false, message: `未知 action：${args.action}`, detail: "" };
      } catch (e) {
        return { ok: false, message: "执行出错：" + (e && e.message ? e.message : String(e)), detail: "" };
      }
    }
  }));
}
