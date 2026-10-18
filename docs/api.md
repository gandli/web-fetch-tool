# API 参考

基址：`http://127.0.0.1:8787`（本地）。所有响应带跨域头；错误不含技术细节。

## 鉴权

写入类接口（`/api/fetch`、`/api/ai`、`/api/archive`）需要令牌：

```bash
bun run token:create -- --name "my-script" --scopes fetch,ai
# token created (shown once):
# wft_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- 令牌仅以 `sha256` 摘要 + 前 12 位前缀存库，创建时显示一次。
- 请求头二选一：`Authorization: Bearer <token>` 或 `X-API-Key: <token>`。
- `scopes`：`fetch`（抓取/存档）、`ai`（AI 加工）、`read`、`*`。
- 未携带 → `401 unauthorized`；scope 不符 → `403 forbidden`。

历史与健康检查为匿名只读（按 IP 限频）。写操作按令牌限频：默认 30/分钟、300/小时。

## POST /api/fetch

抓取并落库，返回统一结构。

```json
{
  "url": "https://example.com",
  "engine": "auto",
  "ai": { "summary": true, "tags": true, "language": "zh" },
  "archive": { "channels": ["telegraph"] }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `url` | 是 | 仅 http/https，≤2048 字符 |
| `engine` | 否 | `auto`（默认）/ `self` / `jina` / `fxtwitter` / `wechat-native` / `github-api` / 已配置的付费引擎 |
| `ai` | 否 | `summary`、`tags`、`translate`、`analyze`、`language`、`quality` |
| `archive` | 否 | `true`（默认渠道）或 `{ "channels": [...] }` |

成功响应（模块 8 结构 + 两个已文档化扩展字段）：

```json
{
  "id": "0f3c…",
  "created_at": "2026-10-18T17:42:02.608Z",
  "provider": "self",
  "url": "https://example.com",
  "title": "Example Domain",
  "platform": "web",
  "content": { "format": "markdown", "text": "…", "length": 156 },
  "metadata": { "author": null, "published_at": null, "language": "en" },
  "og": { "image": "…", "title": "…", "description": null, "site_name": "example.com" },
  "usage": { "fetch_cost_usd": 0 },
  "metrics": { "response_time_ms": 729, "upstream_latency_ms": 606 },
  "status": "ok"
}
```

请求了 `ai` 时附加：

```json
{
  "ai": {
    "available": true,
    "summary": "…",
    "tags": ["…", "…"],
    "analyze": { "key_points": [], "entities": [], "data_points": [], "open_questions": [] },
    "cost_usd": 0.0,
    "model": "google/gemma-4-31b-it:free"
  }
}
```

未配置密钥时附加 `{"ai":{"available":false}}`，抓取结果不受影响。
请求了 `archive` 时附加 `archives: [{channel,status,url,external_id,error_code}]`。

`platform` 枚举：`web | x | wechat | xiaohongshu | weibo | zhihu | github`。
`provider` 实际值：`self | jina | fxtwitter | vxtwitter | wechat-native | github-api`。

## POST /api/ai

```json
{ "id": "<fetch_id>", "task": "summarize", "language": "zh", "summary_length": "medium", "quality": false }
```

- `id` 与 `url` 二选一；传 `url` 会先抓取并落库，再加工。
- `task`：`translate` / `summarize` / `titles` / `tags` / `analyze`。
- 输出内容类型：`translate`/`summarize` 为字符串，`titles`/`tags` 为字符串数组，`analyze` 为对象。

响应：`{id, fetch_id, kind, model, content, cost_usd, created_at}`。

免费模型优先，`quality=true` 时使用 `OPENROUTER_MODEL_QUALITY`（未配置则回落免费模型）。
未配置 `OPENROUTER_API_KEY` → `503 ai_not_configured`；上游 429 → `429 ai_rate_limited`。

## POST /api/archive

```json
{ "id": "<fetch_id>", "channels": ["telegraph", "internet-archive"] }
```

- `telegraph`：免密钥，创建公开快照。
- `internet-archive`：Save Page Now，免密钥但对 X/Twitter 域名不可用，会自动失败并记录。
- 未知/未配置渠道记录为 `skipped` + `archive_not_configured`，不影响其他渠道。

响应：`{id, archives: [{channel,status,url,external_id,error_code}]}`。

## GET /api/history

查询参数：`limit`（1–50，默认 20）、`before`（上一页最后一条的 `created_at`）。

```json
{ "items": [ { "id": "…", "url": "…", "title": "…", "platform": "web", "provider": "self", "status": "ok", "og": {}, "content_length": 156, "created_at": "…" } ], "next_cursor": null }
```

## GET /api/history/{id}

返回统一结构 + `ai_results[]` + `archives[]`。不存在或非法 id → `404 not_found`。

## GET /api/search

在历史记录的标题、正文、URL、作者与站点名上检索。

| 参数 | 必填 | 说明 |
|---|---|---|
| `q` | 是 | 1–200 字符；`%`、`_` 按字面处理 |
| `limit` | 否 | 1–50，默认 20 |
| `offset` | 否 | 0–1000，默认 0 |
| `platform` | 否 | `web` / `x` / `wechat` / `github` … |
| `before` | 否 | 只返回该时间之前的记录（ISO 时间） |
| `sort` | 否 | `relevance`（默认）/ `recent` |

```json
{
  "query": "网页抓取",
  "mode": "substring",
  "fallback": false,
  "total": 1,
  "items": [
    {
      "id": "…",
      "url": "https://mp.weixin.qq.com/s/…",
      "title": "…",
      "platform": "wechat",
      "provider": "wechat-native",
      "snippet": "…网页抓取…",
      "score": 1.0,
      "content_length": 5473,
      "created_at": "2026-05-27T16:00:00.000Z",
      "og": { "image": "…", "title": "…", "description": "…", "site_name": "…" }
    }
  ],
  "next_offset": null,
  "took_ms": 6
}
```

检索模式：

- `mode: "fts"`：英文/数字，使用 `tsvector` 权重（标题 A、正文 B、URL C）与 `ts_rank_cd` 排序。
- `mode: "substring"`：CJK 查询（Postgres 无内置分词器），或 FTS 零命中时的自动回退（`fallback: true`）。
- `snippet` 是纯文本并已去除 Markdown 噪声；高亮由客户端根据 `query` 自行完成。
- 空查询或非法分页参数返回 `400 invalid_body`；只读、匿名可用、按 IP 限频。

## GET /api/health

```json
{
  "status": "ok",
  "version": "0.1.0",
  "database": { "driver": "pglite", "ok": true },
  "providers": { "self": true, "jina": true, "fxtwitter": true, "wechat-native": true, "github-api": true, "paid": [] },
  "ai": { "configured": false, "models": { "free": "…", "quality": null, "fallbacks": [] } },
  "archive": { "channels": [{ "name": "telegraph", "configured": true }] },
  "telegram": { "configured": false, "bindingOpen": false }
}
```

不返回任何密钥或上游错误。

## POST /telegram/webhook

- 必须携带 `X-Telegram-Bot-Api-Secret-Token`，与 `TELEGRAM_WEBHOOK_SECRET` 恒定时间比较。
- 立即返回 `200 {"ok":true}`，随后异步处理；Telegram 重投由 `update_id` 唯一约束去重。

## 错误码

| HTTP | code | 说明 |
|---|---|---|
| 400 | `invalid_url` | 非 http/https、超长、无法解析 |
| 400 | `blocked_url` | 内网/回环/元数据地址、认证信息、非标准端口、DNS 解析到私网 |
| 400 | `invalid_body` | JSON 结构或类型不符、body 超过 64KB |
| 401 | `unauthorized` | 缺少或无效令牌 |
| 403 | `forbidden` | 令牌缺少 scope |
| 404 | `not_found` | 记录或路由不存在 |
| 415 | `unsupported_content` | 非 HTML/文本内容 |
| 422 | `content_empty` | 没有提取到正文 |
| 422 | `platform_experimental` | 小红书/微博/知乎暂未开放 |
| 429 | `rate_limited` / `ai_rate_limited` / `archive_rate_limited` | 频率限制 |
| 503 | `ai_not_configured` / `archive_not_configured` / `telegram_not_configured` | 能力未配置 |
| 504 | `fetch_timeout` | 上游超时 |

错误示例：

```json
{ "error": { "code": "blocked_url", "message": "该链接不允许访问。" } }
```
