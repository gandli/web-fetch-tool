# 验证记录

环境：Windows / Bun 1.4.3 / Node 26.11 / Python 3.15.0 + trafilatura 2.3.1 / Docker Postgres 17。
所有验证均在本机实际执行，非模拟结果。

## 1. 静态检查与测试

```
bunx tsc --noEmit   -> 0 errors
bun test            -> 72 pass, 0 fail (9 files)
```

覆盖：URL 守卫全矩阵（含 DNS 解析到私网、混合解析）、平台识别、OG 四级降级、级联 60% 规则与元数据合并、
Markdown 转换、语言识别、AI 模型顺序与 429、令牌鉴权与 scope、数据库限频窗口、RLS、API 路由与错误、
Telegram 绑定/指令/卡片/幂等、全文检索（FTS 排序、CJK 子串、通配符转义、过滤、分页、snippet）。

## 2. SSRF 守卫（`bun run smoke -- --guard`）

```
ok  http://localhost/                       -> blocked_url
ok  http://127.0.0.1/                       -> blocked_url
ok  http://169.254.169.254/latest/meta-data/ -> blocked_url
ok  http://10.0.0.1/                        -> blocked_url
ok  http://[::1]/                           -> blocked_url
ok  file:///etc/passwd                      -> invalid_url
ok  http://user:pass@example.com/           -> blocked_url
ok  http://example.com:8080/                -> blocked_url
```

## 3. 真实链接抓取

| 链接 | provider | 平台 | 正文长度 | OG |
|---|---|---|---|---|
| `https://example.com` | self | web | 156 | favicon |
| `https://x.com/jack/status/20` | fxtwitter | x | 97 | favicon（无图帖子） |
| `https://mp.weixin.qq.com/s/Y1eC47mTbMWR9YMiowV_xQ` | wechat-native | wechat | 5473 | mmbiz 首图 |
| `https://github.com/cloudflare/workers-sdk` | github-api | github | 6583 | opengraph.githubassets |
| `https://en.wikipedia.org/wiki/Web_scraping` | self + **trafilatura** | web | 41875 | wikipedia favicon |
| `https://www.zhihu.com/question/123456` | — | — | — | `422 platform_experimental`（预期） |

微信公众号：作者 `文娱AB面`、发布时间由页面 `var ct` 解析为 `2026-05-27T16:00:00.000Z`。

## 4. API 行为

```
POST /api/fetch        无令牌              -> 401 unauthorized
POST /api/fetch        无效令牌            -> 401 unauthorized
POST /api/fetch        有效令牌 example.com -> 200，统一结构 + id/created_at
POST /api/fetch        ai 请求但无密钥      -> 200，ai.available=false
POST /api/fetch        169.254.169.254     -> 400 blocked_url
POST /api/fetch        未知字段            -> 400 invalid_body
POST /api/ai           无密钥              -> 503 ai_not_configured
GET  /api/history      -                  -> 200 列表
GET  /api/history/:id  -                  -> 200 正文 + ai_results + archives
GET  /api/health       -                  -> 200，database.ok=true，无密钥泄露
GET  /api/docs         -                  -> 200 text/html，18 个内联图标，无紫色系
GET  /                  -                 -> 302 /api/docs
OPTIONS /api/fetch     -                  -> 204 + CORS 头
```

限频：集成测试中 `perMinute=1` 时第二次请求返回 `429 rate_limited`。

## 5. 持久化

写入一条记录后终止进程并重启（PGlite 文件态 `.data/pglite`），`GET /api/history` 仍返回该记录：

```
{"id":"f411c44d-…","url":"https://example.com","title":"Example Domain",…}
```

## 6. 存档

| 渠道 | 链接 | 结果 |
|---|---|---|
| Telegraph（example.com） | https://telegra.ph/Example-Domain-10-18-253 | ok |
| Telegraph（X 帖子） | https://telegra.ph/just-setting-up-my-twttr-10-18 | ok |
| Internet Archive（example.com） | — | failed / `archive_rate_limited`（SPN 限流，符合预期） |
| Internet Archive（X 帖子） | — | **skipped**（SPN 屏蔽 X 域名，符合规格） |

Telegraph 页面经 Node fetch 复核为 200，标题正确。

## 7. Telegram（无真实令牌的端到端模拟：`bun run tg:sim`）

```
/start（未绑定）        -> 提示 /bind
发送 URL（未绑定）       -> 拒绝：当前对话尚未绑定
/bind wrong-code        -> 绑定码不正确
/bind bind-code-123     -> 绑定成功
/settings               -> 当前设置
发送 URL                -> sendPhoto 卡片（标题 + 摘要 + 站点 + 打开原文按钮）
相同 update_id 重投      -> 被忽略，仅一张卡片
/summary long           -> 摘要长度已设置为 long
/translate on           -> 翻译已开启
```

伪造 webhook secret 的请求返回 401，且不会调用任何 Bot API。

## 8. 真实 Postgres 上的 RLS（`bun run test:pg`）

```
== as anon
  ok    select fetch_history
  ok    insert fetch_history
  deny  select api_tokens        -> 42501
  deny  select telegram_bindings -> 42501
  deny  select platform_sessions -> 42501
== as authenticated
  ok    select ai_results
  ok    update fetch_history
```

## 9. Trafilatura 侧车

```
GET  http://127.0.0.1:8100/health -> {"ok": true, "trafilatura": "2.3.1"}
维基百科页面 extactor=trafilatura, 41875 字
```

未配置 `TRAFILATURA_URL` 时同一页面走 `defuddle`，规则与输出结构一致。

## 10. 全文检索

真实数据（5 条历史记录，含英文网页、GitHub、微信公众号）：

```
q=example           -> 200 mode=fts        total=2  title score=1.00
q=cloudflare        -> 200 mode=fts        total=1  score=6.40
q=文章              -> 200 mode=substring  total=1  wechat 记录，snippet 含关键词
q=文章&platform=wechat -> 200 total=1（过滤生效）
q=markdown          -> 200 mode=substring fallback=true total=0（FTS 零命中后回退）
q=不存在的词         -> 200 total=0 items=[]
```

- 文档页内嵌搜索框实测：输入 `文章` → `共 1 条 · 模式 substring · 6ms`，结果卡片含 2 处高亮。
- 通配符 `%` 按字面处理，不会匹配全表（集成测试覆盖）。
- 迁移 `0004_search.sql` 在既有数据库上增量执行成功，生成列自动回填历史记录。

## 11. 已知限制

- 第三方免密钥接口（fxtwitter / vxtwitter / Jina）可能限流或波动，已做降级与统一文案。
- Save Page Now 对同一 IP 限流明显，示例中出现的 `archive_rate_limited` 属预期。
- 微信公众号可能返回风控/失效页，已识别并转失败，不把验证页当正文。
- 本机 DNS 将所有域名解析到 `198.18.0.0/15`，该段已放行；其余私网段仍然拦截。
