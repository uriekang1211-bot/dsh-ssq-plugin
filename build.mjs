// 构建：把 history.json + src/style.css + src/app.js 合成为单文件 dist/index.html
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, "src/style.css"), "utf8");
const js = readFileSync(join(root, "src/app.js"), "utf8");
const data = JSON.stringify(JSON.parse(readFileSync(join(root, "history.json"), "utf8")));

let html = readFileSync(join(root, "template.html"), "utf8");
html = html
  .replace("/*__CSS__*/", () => css)
  .replace("/*__DATA_JSON__*/", () => data)
  .replace("/*__APP_JS__*/", () => js);

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist/index.html");
writeFileSync(out, html);
console.log(`built ${out}  (${(html.length / 1024).toFixed(1)} KB)`);
