# GitHub Actions 定时触发中心

Cloudflare Worker + D1 实现的多账号、多仓库 GitHub Actions 定时触发中心：
- 多账号 PAT 管理（AES-GCM 加密存储，支持在线验证）
- 任意 cron / 固定间隔 / 随机间隔调度，任务互相独立
- workflow_dispatch 与 repository_dispatch 双触发方式
- 完整触发记录（成功/失败/HTTP 状态/错误信息）与手动触发
- Web 管理页（单管理密码登录）

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入 ADMIN_PASSWORD 与 TOKEN_ENC_KEY（随机长字符串）
npm run db:local                 # 初始化本地 D1
npm run dev                      # http://localhost:5173
```

测试本地 scheduled（需先 `npm run build`）：

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"   # 返回 {"outcome":"ok",...}
```

> 端点说明：wrangler 4.x 使用 `/cdn-cgi/local/scheduled`；旧版 wrangler（≤3.x）使用 `curl "http://localhost:8787/__scheduled?cron=*"`。

## 部署

1. 创建 D1 数据库，并把返回的 database_id 填入 `wrangler.jsonc`：

   ```bash
   npx wrangler d1 create cronjob
   ```

2. 初始化远程数据库表结构：

   ```bash
   npm run db:init
   ```

3. 设置两个 Secret（TOKEN_ENC_KEY 建议用 `openssl rand -hex 32` 生成；换钥匙会导致已存 token 无法解密）：

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put TOKEN_ENC_KEY
   ```

4. 部署：

   ```bash
   npm run deploy
   ```

## 使用说明

- GitHub 仓库的 workflow 需声明对应触发器：
  - `workflow_dispatch`：workflow 文件里写 `on: workflow_dispatch`（可带 inputs）
  - `repository_dispatch`：workflow 文件里写 `on: repository_dispatch: [事件类型]`
- cron 表达式按 **UTC** 计算（北京时间减 8 小时）。
- 调度器每 5 分钟扫描一次到期任务；Cloudflare 免费计划可能有约 1 分钟的 cron 延迟。

## 技术栈

Hono · React 18 · Vite · Tailwind CSS v4 · Cloudflare Workers · D1 · Vitest
