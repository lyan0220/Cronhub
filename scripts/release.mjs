#!/usr/bin/env node
// 一键发布：把 dev 分支内容同步到 main（剔除非生产文件）
// 用法：在 dev 分支上运行 npm run release，确认后手动 git push origin main
import { execSync } from "node:child_process";

const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] });
const shOut = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

// main 分支不保留的开发文件（含本脚本自身）
const NON_PROD = ["test", "docs", ".dev.vars.example", "vitest.config.ts", "scripts"];

// 1. 前置检查：必须在 dev 分支且工作区干净
const branch = shOut("git branch --show-current");
if (branch !== "dev") {
  console.error("✗ 请在 dev 分支上运行（当前：" + branch + "）");
  process.exit(1);
}
if (shOut("git status --porcelain")) {
  console.error("✗ 工作区有未提交改动，请先提交或暂存");
  process.exit(1);
}

const devHead = shOut("git rev-parse --short HEAD");

// 2. 切到 main，把 dev 的全部文件同步过来（快照式，无合并冲突）
sh("git checkout main");
sh("git checkout dev -- .");

// 3. 剔除非生产文件（-f：checkout dev -- . 会把这些文件带入暂存区，需强制删除）
sh(`git rm -r -f -q --ignore-unmatch ${NON_PROD.join(" ")}`);

// 4. 提交（有变化才提交）
if (shOut("git status --porcelain")) {
  sh(`git add -A`);
  sh(`git commit -m "release: 同步 dev @ ${devHead}"`);
  console.log(`✓ main 已同步到 dev@${devHead}`);
} else {
  console.log("✓ main 与 dev 已一致，无需提交");
}

// 5. 切回 dev，提示手动 push（push 即触发生产部署，由人确认）
sh("git checkout dev");
console.log("\n下一步：确认无误后执行  git push origin main  触发自动部署");
