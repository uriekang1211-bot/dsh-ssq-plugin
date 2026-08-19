// 构建：把 history.json + src/*.css + src/app.cjs 合成单文件 HTML
//  - dist/index.html        桌面版（template.html + style.css）
//  - dist/index-mobile.html 移动版（template-mobile.html + style-mobile.css）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const js = readFileSync(join(root, "src/app.cjs"), "utf8");
const data = JSON.stringify(JSON.parse(readFileSync(join(root, "history.json"), "utf8")));

function build(templateFile, cssFile, outFile) {
  const css = readFileSync(join(root, cssFile), "utf8");
  let html = readFileSync(join(root, templateFile), "utf8");
  html = html
    .replace("/*__CSS__*/", () => css)
    .replace("/*__DATA_JSON__*/", () => data)
    .replace("/*__APP_JS__*/", () => js);
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, outFile), html);
  console.log(`built ${join(root, outFile)}  (${(html.length / 1024).toFixed(1)} KB)`);
}

build("template.html", "src/style.css", "dist/index.html");
build("template-mobile.html", "src/style-mobile.css", "dist/index-mobile.html");

// 同步插件内置数据快照（DSH 插件包 data/ 目录）
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data/ssq-history.json"), readFileSync(join(root, "history.json")));
console.log("synced data/ssq-history.json");
