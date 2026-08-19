# 🎱 双色球助手（SSQ Helper）

一个双色球分析**双形态插件**：
- **DSH 插件**（推荐）：安装进 DeepSeek Harness 后，在对话里直接让模型调用 `ssq` 工具做趋势分析、预测、胆拖/随机选号
- **单文件 HTML**：`dist/index.html` 浏览器双击即用，带可视化图表，无需安装

## 安装到 DSH

### 方式一：插件市场（收录后可用）
打开 DSH Web → **设置 → 插件市场** → 搜索 `ssq` 一键安装（需先被 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 目录收录，见下文「提交收录」）。

### 方式二：命令行直接安装（现在就可用）
```sh
dsh plugin --profile web add github:uriekang1211-bot/dsh-ssq-plugin
```
装完后刷新页面（或重启 `dsh web`），然后在对话里使用，例如：
- 「用 ssq 统计最近 100 期每个号码的出现趋势」
- 「用 ssq 冷号回补模型预测下一期」
- 「用 ssq 按胆拖规则生成 5 注：胆码 01 08，拖码 12 15 20 23 28 31，蓝球 05 09」

插件自动多源拉取**最近 1000 期**开奖数据（官方接口 → GitHub 镜像 → CDN），失败时回退内置快照。

### 卸载
```sh
dsh plugin --profile web remove dsh-ssq-plugin
```

## 快速开始（HTML 版）

双击打开 **`dist/index.html`** 即可（Chrome / Edge / Safari 均可）。

## 三大功能

### 1️⃣ 趋势追踪（历史千期）
- 统计最近 **10–1000 期**（默认 1000 期）每个号码的表现：出现次数、频率、近 10 期、当前遗漏、最大遗漏、平均遗漏
- 热 / 温 / 冷 三档热度标记，近 10 期 vs 前 10 期对比趋势箭头（↑↓→）
- 红球 / 蓝球出现次数柱状图（点击柱子查看该号码的「滚动 10 期频率」走势曲线）
- 最近 N 期（10/20/30/50）出现热力图

### 2️⃣ 智能预测（下一期频率估算）
- 模型：`频率信号 + 近期衰减信号 + 遗漏回补信号` 加权评分 → softmax 归一化
- 三套权重预设：**均衡混合 / 冷号回补 / 热号延续**
- 输出：33 个红球与 16 个蓝球的**预测概率排名**、**下期期望出现次数**、信号分解
- 「按预测概率模拟 10 注」：按模型概率加权随机抽样

> ⚠️ 双色球每次开奖均为**独立随机事件**，任何统计/预测都不能提高中奖概率。本工具仅供娱乐参考，请理性购彩。

### 3️⃣ 选号生成
- **纯随机**：任意注数，6 红（1–33 不重复）+ 1 蓝（1–16）
- **胆拖（双色球官方玩法规则）**：
  - 胆码 **1–5 个**（每注必中）
  - 拖码 ≥ **6 − 胆码数** 个
  - 蓝球 1 个及以上
  - 每注 = 全部胆码 + 从拖码取足 6 红 + 1 蓝
  - 支持「生成全部组合」或「随机抽取 N 注」，自动显示**注数与金额**（2 元/注），可导出全部组合为 .txt

## 数据说明

- 内置最新 **1000 期**开奖数据（数据源：中国福利彩票发行管理中心官网 cwl.gov.cn，`issueCount=1000` 一次拉取）
- 数据过期后，**三种更新方式**（按推荐顺序）：

| 方式 | 操作 | 说明 |
|---|---|---|
| ① 页面在线更新 | 点「**在线更新**」 | 自动**多源降级**：官方直连 → GitHub 每日镜像（raw）→ jsDelivr CDN。官方接口无 CORS 头浏览器会拦截，此时自动切换镜像源（镜像带 `Access-Control-Allow-Origin: *`，浏览器可直连） |
| ② 本机一键脚本 | 终端运行 `node update-data.mjs` | 无浏览器跨域限制，直接拉官方接口 → 重写 `history.json` → 自动重建 `dist/index.html`，**最可靠** |
| ③ 手动导入 | 「导出数据」→ 替换 JSON → 「导入数据」 | 兜底方案 |

- 在线更新失败时，页面会列出每个数据源的具体失败原因，并提示上述备选方案。
- 官方数据接口示例：
  `https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=100`
- 数据镜像仓库：[sinyu1012/Double-Color-Ball-AI](https://github.com/sinyu1012/Double-Color-Ball-AI)（每日更新）

## 文件结构

```
dsh-ssq-plugin/
├── package.json        ← DSH 插件包清单（dsh.bundle 声明）
├── cordis.patch.yml    ← 插件 layer 插入补丁
├── lib/index.js        ← DSH 插件入口（注册 ssq 聊天工具）
├── lib/ssq-core.js     ← 插件版核心逻辑（ESM）
├── data/ssq-history.json ← 插件内置数据快照
├── dist/index.html     ← HTML 版成品（单文件，直接打开）
├── template.html       ← HTML 版页面模板
├── src/style.css       ← HTML 版样式
├── src/app.cjs         ← HTML 版核心逻辑（统计 / 预测 / 胆拖随机）
├── history.json        ← 百期开奖数据快照
├── build.mjs           ← 构建脚本（node build.mjs）
├── update-data.mjs     ← 本机一键更新数据脚本（node update-data.mjs）
└── test.cjs            ← 算法自测（node test.cjs，含浏览器版/插件版一致性）
```

## 提交收录（让插件进入 DSH 插件市场）

> 当前版本要求：仓库创建满 **1 天**、提交数 **≥ 10**、`package.json` 声明 `dsh.bundle`（本仓库已满足），并为仓库添加 `dsh-plugin` topic（仓库设置 → Topics）。以上由上游 CI 自动校验。

1. 向 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 PR，新增一个文件 `data/plugins/uriekang1211-bot__dsh-ssq-plugin.yml`：
   ```yaml
   url: https://github.com/uriekang1211-bot/dsh-ssq-plugin
   name: uriekang1211-bot/dsh-ssq-plugin
   category: tools
   description:
     en: 'SSQ (China Welfare Lottery Double Color Ball) helper for DeepSeek Harness: 1000-draw trend tracking, frequency prediction and dan-tuo/random generation via the ssq tool.'
     zh: '双色球助手 DSH 插件：千期趋势追踪、智能预测、胆拖/随机选号，对话中直接调用 ssq 工具。'
   ```
2. 在 fork 中运行 `npm ci && node scripts/generate-readme.mjs` 重新生成两个 README，与 YAML 一起提交（README 由脚本生成，勿手改）
3. 收录后（通常一天内），在 DSH Web 的插件市场即可一键安装

## 开发

```bash
cd dsh-ssq-plugin
node build.mjs   # 重新构建 dist/index.html 并同步 data/ 快照
node test.cjs    # 运行算法自测
```

## 免责声明

本工具仅供学习与娱乐参考，不构成任何投注建议。请理性购彩、量力而行，未成年人禁止购彩。
