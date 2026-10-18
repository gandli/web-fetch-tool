# web-fetch-tool

多渠道网页内容抓取、加工与存档工具。一条流水线，四类入口：
`URL → 平台识别 → 免费优先抓取 → 正文净化 → OG 提取 → 统一 JSON → 落库 →（可选）AI / 存档`。

本仓库当前交付的是**本地可运行的第一阶段**：核心流水线 + **对外 API** + **Telegram Bot**。
网站主界面、浏览器扩展与其余存档渠道已留好接口，不在本轮范围内。

![API 文档页](docs/assets/docs-page.png)

## 快速开始

```powershell
cd web-fetch-tool
bun install
bun run migrate                       # 默认 PGlite，零安装
bun run token:create -- --name dev --scopes fetch,ai
bun run dev
```

打开 <http://127.0.0.1:8787/api/docs> 查看可复制的接口文档。

```powershell
$TOKEN = "wft_..."     # token:create 的输出，仅显示一次
curl.exe -s -X POST http://127.0.0.1:8787/api/fetch `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  --data-binary '{"url":"https://example.com"}'
```

> Windows PowerShell 会吞掉原生命令参数里的双引号，上面的 `--data-binary` 里若遇到问题，
> 可把 JSON 写进文件后使用 `--data-binary "@body.json"`。

无需任何密钥即可使用：自建抓取、Jina Reader、Telegraph 存档、X / 微信公众号 / GitHub 专项通道。
`OPENROUTER_API_KEY` 只影响 AI 能力，缺失时返回友好提示而不会影响抓取。

## 目录结构

```
src/
  app.ts                    # 路由 + 统一错误/CORS（runtime-neutral Request/Response）
  server.ts                 # 本地 Bun 入口
  config.ts                 # 环境变量（缺失只降级，不崩溃）
  contracts/                # 统一 JSON、错误码、zod 入参
  core/
    url-guard.ts            # SSRF 防护：协议/端口/主机/DNS/重定向
    platform.ts             # 平台识别与路由
    fetch/                  # self / jina / fxtwitter / wechat / github / paid 适配器
    extract/                # Trafilatura/defuddle + Readability 级联、Markdown、语言
    og.ts                   # OG 四级降级链
    pipeline.ts             # 业务流水线
  ai/                       # OpenRouter（免费模型优先 + 质量模式）
  archive/                  # Telegraph / Internet Archive 适配器
  db/                       # PGlite/pg 双驱动、迁移、仓储、RLS
  search/                   # 全文检索（FTS + CJK 子串）与片段生成
  auth/                     # 令牌（sha256）与数据库限频
  telegram/                 # webhook、指令、绑定、卡片、Bot API 客户端
  docs-page.ts              # /api/docs 单文件文档页
migrations/                 # 0001 建表 / 0002 RLS + 授权 / 0003 限频函数 / 0004 全文检索
scripts/                    # migrate、create-token、smoke、telegram-sim、test-pg
services/extractor/         # 可选 Trafilatura Python 侧车
tests/                      # 72 个单元 + 集成测试
```

## 平台通道

| 平台 | 识别 | 通道 | 状态 |
|---|---|---|---|
| 普通网页 | 默认 | 自建抓取 → Jina → 付费兜底 | ✅ 已验证 |
| X 帖子 | `x.com|twitter.com/.../status/<id>` | fxtwitter → vxtwitter | ✅ 已验证 |
| 微信公众号 | `mp.weixin.qq.com` | 原生 `#js_content` 解析 → Jina | ✅ 已验证 |
| GitHub 仓库 | `github.com/{owner}/{repo}` | GitHub REST（README + 元数据） | ✅ 已验证 |
| 小红书 / 微博 / 知乎 | 域名匹配 | 浏览器渲染 + 登录态 | ⛔ 识别后友好拒绝（实验性） |

真实链接实测（`bun run smoke <url>`）：

| 链接 | provider | 结果 |
|---|---|---|
| `https://example.com` | self | 标题、正文、favicon OG、0 成本 |
| `https://x.com/jack/status/20` | fxtwitter | 作者/时间/正文结构化 |
| `https://mp.weixin.qq.com/s/Y1eC47mTbMWR9YMiowV_xQ` | wechat-native | 5473 字正文 + 首图 OG |
| `https://github.com/cloudflare/workers-sdk` | github-api | 仓库介绍 + README 6583 字 |
| `https://en.wikipedia.org/wiki/Web_scraping` | self + **trafilatura** | 41875 字，元数据合并 |

## 净化与 OG

- **精度提取器**：配置 `TRAFILATURA_URL` 时走真实 Trafilatura（Python 侧车，已在 Python 3.15 / trafilatura 2.3.1 验证）；
  否则使用 `defuddle`。
- **召回提取器**：`@mozilla/readability` + `linkedom`。
- **择优规则**：两者并行，精度正文 < 召回 60% 时回退召回，否则用精度；元数据逐字段取非空；差异写入 `extract_debug`。
- **OG 降级**：`og:image` → `twitter:image` → 正文首张有效大图 → favicon → `/static/placeholder.svg`。
- Markdown 统一保留标题、列表、代码块、表格、图片；原始 HTML 截断 2MB 仅落库，不经 API 返回。

## API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/fetch` | `fetch` | 抓取并落库，返回统一 JSON |
| POST | `/api/ai` | `ai` | translate / summarize / titles / tags / analyze |
| POST | `/api/archive` | `fetch` | 对已有记录补存档 |
| GET | `/api/history` | 无（IP 限频） | 游标分页历史 |
| GET | `/api/history/:id` | 无（IP 限频） | 含 Markdown、AI 结果、存档链接 |
| GET | `/api/search` | 无（IP 限频） | 标题 + 正文全文检索 |
| GET | `/api/health` | 无 | 数据库与能力配置状态 |
| GET | `/api/docs` | 无 | 文档页 |
| POST | `/telegram/webhook` | Telegram secret | Bot 更新入口 |

错误统一为 `{"error":{"code":"...","message":"..."}}`，只返回简短中文提示，不暴露上游、堆栈或密钥。
详见 [docs/api.md](docs/api.md)。

## 全文检索

`GET /api/search?q=关键词` 在历史记录的标题与正文上检索：

- **英文/数字**：Postgres 全文索引（`tsvector`，标题权重 A、正文 B、URL C），`ts_rank_cd` 排序；
  索引无命中时自动回退子串匹配，不会因为词形差异直接返回空。
- **中文/日文/韩文**：Postgres 无内置分词器，自动使用转义后的子串匹配，按"标题 > URL > 正文"排序。
- 支持 `platform` 过滤、`limit`/`offset` 分页（返回 `next_offset`）、`sort=relevance|recent`。
- 返回纯文本 `snippet`（已去除 Markdown 噪声），前端自行高亮。
- 只读、匿名可用，按 IP 限频（默认 60/分钟）。

```bash
curl -s "http://127.0.0.1:8787/api/search?q=markdown&limit=10"
curl -s "http://127.0.0.1:8787/api/search?q=网页抓取&platform=wechat"
bun run search -- "网页抓取"
```

![全文检索](docs/assets/search.png)

## Telegram Bot

```powershell
$env:TELEGRAM_BOT_TOKEN="123:ABC"
$env:TELEGRAM_WEBHOOK_SECRET="至少 16 位随机串"
$env:TELEGRAM_BIND_CODE="至少 8 位绑定码"
bun run tg:set-webhook --url https://your-domain/telegram/webhook
```

- 仅绑定对话可用：`/bind <绑定码>`；也支持 `TELEGRAM_ALLOWED_CHAT_IDS` 白名单。
- 指令：`/start`、`/help`、`/lang <code>`、`/translate on|off`、`/archive on|off`、`/summary short|medium|long`、`/settings`、`/unbind`。
- 发链接后回复卡片：标题 + 摘要 + 标签 + 站点 + `打开原文` / `存档快照` 按钮；有 OG 图用 `sendPhoto`，失败自动退回文本。
- 单对话限频（默认 5/分钟、40/小时），`update_id` 唯一约束保证 Telegram 重投幂等。

无真实令牌时可完整验证：

```powershell
bun run tg:sim                 # 本地假 Bot API + 真实 webhook 路由 + 真实抓取
bun run tg:sim -- --archive    # 额外验证 Telegraph 存档链接
```

## 数据库

默认 `DB_DRIVER=pglite`（内嵌 Postgres，文件态 `.data/pglite`，零安装）。
需要与线上一致时：

```powershell
docker compose up -d db
$env:DB_DRIVER="pg"
$env:DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/web_fetch"
bun run migrate
bun run test:pg                # 真实 Postgres 上的 RLS 对照检查
```

表：`fetch_history`、`ai_results`、`archive_records`、`api_tokens`、`telegram_bindings`、`telegram_logs`、
`platform_sessions`、`app_settings`、`rate_limit_counters`。

RLS：前三张业务表对 `anon` / `authenticated` 开放读写（共享工具记录）；令牌、绑定、日志、登录态、配置、限频表
不授予任何策略与权限，仅服务端角色可访问。

## 测试

```powershell
bun test          # 72 个测试：URL 守卫、平台、OG、级联、AI、令牌、限频、RLS、API、Telegram、全文检索
bunx tsc --noEmit
bun run smoke -- --guard https://example.com
```

## 环境变量

见 [.env.example](.env.example)。关键项：

| 变量 | 作用 | 默认 |
|---|---|---|
| `DB_DRIVER` | `pglite` / `pg` | `pglite` |
| `API_AUTH_REQUIRED` | 写入类接口是否强制令牌 | `true` |
| `TRAFILATURA_URL` | 真实 Trafilatura 侧车地址 | 空（回退 defuddle） |
| `OPENROUTER_API_KEY` | AI 能力 | 空（友好降级） |
| `OPENROUTER_MODEL_FREE` | 免费模型 | `google/gemma-4-31b-it:free` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_BIND_CODE` | Bot 接入 | 空 |
| `TELEGRAPH_ENABLED` | 免密钥存档 | `true` |
| `HTTP_TIMEOUT_MS` / `MAX_HTML_BYTES` / `MAX_CONTENT_CHARS` | 抓取与正文上限 | 15s / 8MB / 60000 |

## 说明与限制

- 仅允许 `http/https`，拒绝内网、回环、链路本地、CGNAT、云元数据地址与非法端口，并对每次重定向重新校验。
- 某些沙箱/企业 DNS 会把所有域名解析到 `198.18.0.0/15`（基准测试段），因此该段被放行；其余私网段仍然拦截。
- X 由第三方免密钥接口提供；微信公众号可能返回验证页，此时自动转 Jina 并识别为失败，而不是把验证页当正文。
- 付费抓取引擎（Firecrawl/Tavily/Exa/TinyFish 等）与 S3/GitHub/Notion 存档仅保留适配器接入位，本轮未接线。
- 后续部署到 Bolt Cloud / Cloudflare Workers / Deno 时，只需替换 `src/server.ts` 入口与数据库驱动；
  `createApp().handle(Request)` 本身是 Web 标准的。

## 相关文档

- [docs/api.md](docs/api.md) — 接口与错误码
- [docs/decisions.md](docs/decisions.md) — 默认决策、偏差与风险
- [services/extractor/README.md](services/extractor/README.md) — Trafilatura 侧车
