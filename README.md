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
- 「用 ssq 冷号回补模型预测下一期」（默认基于最近 1000 期）
- 「用 ssq 基于最近 500 期数据预测下一期」（`window=500` 指定预测数据范围）
- 「用 ssq 按胆拖规则生成 5 注：胆码 01 08，拖码 12 15 20 23 28 31，蓝球 05 09」

插件自动多源拉取**最近 1000 期**开奖数据（官方接口 → GitHub 镜像 → CDN），失败时回退内置快照。

### 卸载
```sh
dsh plugin --profile web remove dsh-ssq-plugin
```

## 快速开始（HTML 版）

双击打开 **`dist/index.html`** 即可（桌面，Chrome / Edge / Safari 均可）。
手机访问请打开 **`dist/index-mobile.html`**（移动版，底部导航 + 大触控目标，已去掉导入/导出按钮）。

## 三大功能

### 1️⃣ 趋势追踪（历史千期）
- 统计最近 **10–1000 期**（默认 1000 期）每个号码的表现：出现次数、频率、近 10 期、当前遗漏、最大遗漏、平均遗漏
- 热 / 温 / 冷 三档热度标记，近 10 期 vs 前 10 期对比趋势箭头（↑↓→）
- 红球 / 蓝球出现次数柱状图（点击柱子查看该号码的「滚动 10 期频率」走势曲线）
- 最近 N 期（10/20/30/50）出现热力图

### 2️⃣ 智能预测（下一期频率估算）
- **三种分析模式**(单选切换,结果区互斥显示,不会叠加):**① 单模型预测 / ② 集成投票 / ③ 组合结构预测**
- 操作方式:选分析模式 →(单模型模式)选模型预设 → 选预测数据范围 → 点「开始分析」
- 模型：`频率信号 + 近期衰减信号 + 遗漏回补信号 + EWMA 加权` 加权评分 → softmax 归一化
- **6 种模型预设**：
  - **均衡混合**（默认，频率 40% · 近期 30% · 遗漏回补 30%）
  - **冷号回补**（侧重当前遗漏超期未出）
  - **热号延续**（侧重近期高频出现）
  - **EWMA 近期加权**（指数加权突出近期走势，选中后显示**半衰期 20/50/100 期**选项）
  - **遗漏均值回归**（遗漏 85% + 频率 15% 混合，超期未出为主、防极端）
  - **期望偏差回补**（频率反向 60% + 遗漏 40%，大数回归为主、适度回补）
- **② 集成投票**：6 个模型各自推荐红球 Top6 + 蓝球 Top1，票数高者胜出（同票按平均概率排序），输出综合推荐
- **③ 组合结构预测**：统计窗口内红球的**奇偶比 / 大小比 / 三区间 / 和值区间**历史频率，预测最可能结构并生成按该结构筛选的选号组合
- **预测数据范围可选**：最近 50 / 100 / 200 / 300 / 500 / 800 / 1000 期（默认 1000，与趋势页窗口相互独立），三种模式共用
- 输出：33 个红球与 16 个蓝球的**预测概率排名**、**下期期望出现次数**、信号分解
- 「按预测概率模拟 10 注」：按模型概率加权随机抽样（单模型/集成模式可用）
- **DSH 插件版**：`predict` 通过 `window` 指定预测数据范围、`preset` 选择模型、`ewmaHalf` 指定 EWMA 半衰期；另有 `ensemble`（集成投票）与 `structure`（组合结构预测）两个独立 action

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

- 内置 **最近 1000 期**开奖数据（数据源：中国福利彩票发行管理中心官网 cwl.gov.cn），历史数据**直接保存在本地**（插件内置快照 `data/ssq-history.json` / HTML 内嵌 `history.json`），离线也能完整分析
- 更新采用**增量机制**：只在本地基线基础上拉取**最新 200 期**（官方接口 `issueCount=200`）→ 按期号去重合并 → 截取最近 1000 期；快照过期太久（合并出现缺口）时自动回退全量 `issueCount=1000` 重建；更新后显示「当前 N 期（最旧 ~ 最新）」
- 数据过期后，**三种更新方式**（按推荐顺序）：

| 方式 | 操作 | 说明 |
|---|---|---|
| ① 页面在线更新 | 点「**在线更新**」 | 增量合并更新：官方增量 → 官方全量回退 → GitHub 镜像 / jsDelivr CDN（带 CORS 头，浏览器可直连）。更新后提示「当前 1000 期（最旧 ~ 最新）」 |
| ② 本机一键脚本 | 终端运行 `node update-data.mjs` | 无浏览器跨域限制，直接拉官方全量 1000 期 → 重写 `history.json` → 自动重建 `dist/index.html`，**最可靠** |
| ③ 手动导入 | 「导出数据」→ 替换 JSON → 「导入数据」 | 兜底方案 |

- 在线更新失败时，页面会列出每个数据源的具体失败原因，并提示上述备选方案。
- 官方数据接口示例：
  `https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=200`
- 数据镜像仓库：[sinyu1012/Double-Color-Ball-AI](https://github.com/sinyu1012/Double-Color-Ball-AI)（每日更新）

## 文件结构

```
dsh-ssq-plugin/
├── package.json        ← DSH 插件包清单（dsh.bundle 声明）
├── cordis.patch.yml    ← 插件 layer 插入补丁
├── lib/index.js        ← DSH 插件入口（注册 ssq 聊天工具）
├── lib/ssq-core.js     ← 插件版核心逻辑（ESM）
├── data/ssq-history.json ← 插件内置数据快照
├── dist/index.html     ← HTML 版成品（桌面版，单文件）
├── dist/index-mobile.html ← HTML 版成品（移动版，单文件，无导入导出）
├── template.html       ← HTML 版桌面模板
├── template-mobile.html ← HTML 版移动模板
├── src/style.css       ← HTML 版桌面样式
├── src/style-mobile.css ← HTML 版移动样式
├── src/app.cjs         ← HTML 版核心逻辑（统计 / 预测 / 胆拖随机，两版共用）
├── history.json        ← 百期开奖数据快照
├── build.mjs           ← 构建脚本（node build.mjs，一次构建桌面+移动两版）
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
     en: 'SSQ (China Welfare Lottery Double Color Ball) helper for DeepSeek Harness: 1000-draw trend tracking, six prediction models with ensemble voting, structure analysis and dan-tuo/random generation via the ssq tool.'
     zh: '双色球助手 DSH 插件：千期趋势追踪、6 种预测模型与集成投票、组合结构分析、胆拖/随机选号，对话中直接调用 ssq 工具。'
   ```
2. 在 fork 中运行 `npm ci && node scripts/generate-readme.mjs` 重新生成两个 README，与 YAML 一起提交（README 由脚本生成，勿手改）
3. 收录后（通常一天内），在 DSH Web 的插件市场即可一键安装

## 开发

```bash
cd dsh-ssq-plugin
node build.mjs   # 重新构建 dist/index.html 并同步 data/ 快照
node test.cjs    # 运行算法自测
```

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)（v1.1.0：数据升级为最近 1000 期，插件与 HTML 版同步）。

## 免责声明

本工具仅供学习与娱乐参考，不构成任何投注建议。请理性购彩、量力而行，未成年人禁止购彩。
