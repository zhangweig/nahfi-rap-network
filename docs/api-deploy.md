# 部署投稿 API（Cloudflare Workers + D1）

页面托管在 GitHub Pages，只能放静态文件，所以「添加人物 / 添加关系 / 站长审核」需要一套独立的后端。
这份文档把 `server/` 里的投稿审核服务搬到了 Cloudflare Workers，数据库用 D1（SQLite，语法与本地一致）。

部署完你会有两个地址：

| 用途 | 地址 |
| --- | --- |
| 页面 | `https://zhangweig.github.io/nahfi-rap-network/` |
| API | `https://nahfi-rap-network-api.<你的子域>.workers.dev` |

## 0. 前提

- 一个 Cloudflare 账号（免费层够用：Workers 每天 10 万次请求，D1 每天 500 万次读）
- 本机已 `npm install`

## 1. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create nahfi-rap-network
```

输出里会有一行 `database_id = "xxxxxxxx-xxxx-..."`，把它填进 `wrangler.toml` 的
`[[d1_databases]] → database_id`，替换掉 `REPLACE_WITH_YOUR_DATABASE_ID`。

## 2. 建表

远程库（线上用这个）：

```bash
npx wrangler d1 execute nahfi-rap-network --remote --file=worker/schema.sql
```

本地调试用的库：

```bash
npx wrangler d1 execute nahfi-rap-network --local --file=worker/schema.sql
```

> `schema.sql` 全部是 `CREATE TABLE IF NOT EXISTS`，**已有部署升级时也要重跑一次**，
> 否则新增的表（如勘误队列 `reports`）不会建出来，`/api/reports` 会直接 500。
> 重跑不会清空已有数据。

## 3. 设置审核密钥

```bash
npx wrangler secret put ADMIN_PASSWORD
```

要求至少 16 位，随机生成即可，例如：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

这个值就是审核台登录密码，**不要写进仓库**。它就是原来 `.data/owner-key.txt` 里的那把钥匙。

## 4. 部署 Worker

```bash
npm run api:deploy
```

`api:deploy` 会先用 `scripts/build-data.mjs` 生成 `server/generated/base-data.json`（基线人物数据，
不入库），再执行 `wrangler deploy`。第一次部署会打印最终的 `workers.dev` 地址。

改完 `worker/` 下的代码重新执行这一条即可。

## 5. 让页面指向这个 API

GitHub 仓库 → Settings → Secrets and variables → Actions → **Variables** → New repository variable：

| Name | Value |
| --- | --- |
| `VITE_API_BASE` | `https://nahfi-rap-network-api.<你的子域>.workers.dev` |

然后重新跑一次 Pages 部署（推一个空提交，或在 Actions 里手动 Run workflow）。
`.github/workflows/deploy.yml` 会把它注入成 `VITE_API_BASE`，前端构建时写死进包里。

> 变量留空时前端退回同源 `/api`，页面又变成只读浏览版 —— 这是刻意的降级，不会报错。

## 6. 验证

```bash
# 应该返回节点数据而不是 404
curl -s https://nahfi-rap-network-api.<你的子域>.workers.dev/api/data | head -c 200

# 预检请求应返回 204 且带 Access-Control-Allow-Origin
curl -s -i -X OPTIONS https://nahfi-rap-network-api.<你的子域>.workers.dev/api/submissions \
  -H "Origin: https://zhangweig.github.io" \
  -H "Access-Control-Request-Method: POST" | head -12
```

打开线上页面，页脚应显示「投稿服务已连接」，顶部出现「添加人物 / 添加关系」。

## 与本地 Node 服务的关系

| | 本地 `npm run dev` | 线上 Workers |
| --- | --- | --- |
| 入口 | `server/index.mjs` | `worker/index.mjs` |
| 存储 | `.data/community.sqlite`（node:sqlite） | D1（`worker/schema.sql`） |
| 鉴权 | HttpOnly Cookie `nahfi_owner` | `Authorization: Bearer <token>`（localStorage） |
| 静态文件 | 由 Node 一起提供 | 不管，页面在 Pages |
| 业务规则 | `server/domain.mjs` | **同一份** `server/domain.mjs` |

两套后端共用 `domain.mjs` 的校验与合成逻辑，所以审核规则只有一处定义，不会出现线上放行了本地拦不住的情况。

改鉴权方式的原因是跨站：页面在 `zhangweig.github.io`、API 在 `workers.dev`，属于不同站点，
`SameSite` cookie 在跨站请求里时灵时不灵（浏览器第三方 cookie 策略还在收紧），换成 Bearer token 更稳。
token 存 `localStorage`，有效期 8 小时，过期后 `api()` 会收到 401 并自动清掉本地 token。

## 日常维护

- **审核通过的数据什么时候对网友可见？** 立即。`/api/data` 每次请求都会把 `base-data.json` 与
  `approved` 表合成后返回，不需要重新部署页面。
- **基线人物数据改了怎么办？** 改 `src/data/rap-data.ts` → 重新 `npm run build` 推 Pages →
  再跑一次 `npm run api:deploy`，让 Worker 内置的新快照生效。
- **忘了密钥？** `npx wrangler secret put ADMIN_PASSWORD` 覆盖，旧会话全部失效（重启即清空 sessions）。
- **删掉某条已通过的投稿？**
  `npx wrangler d1 execute nahfi-rap-network --remote --command="DELETE FROM approved WHERE entity_id='xxx'"`

## 一个需要提前知道的风险

`*.workers.dev` 域名在国内部分网络下解析不稳。如果确实遇到打不开，可以：

1. 在 Cloudflare 里给 Worker 绑一个自有域名（Custom Domain），可达性通常更好；
2. 或者换一家能跑 Node + 持久磁盘的平台（Railway / Fly / Zeabur），把 `server/` 原样部署，
   此时前端只需把 `VITE_API_BASE` 指过去，页面代码不用动。
