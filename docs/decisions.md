# 默认决策、偏差与风险

开发中遇到规格未覆盖或与本地运行环境冲突的点，按"免费优先、开箱可用、安全不暴露"选择默认值。
以下每一项都可以在后续改动，且都留有接口。

## 1. 本轮范围

交付：核心流水线 + 对外 API + Telegram Bot + API 文档页 + 测试。
延后：网站主界面、浏览器扩展与 Obsidian、小红书/微博/知乎浏览器渲染、S3/GitHub/Notion 存档、Mercury 站点规则。

理由：用户指定"先从 API / Telegram Bot 开始"；这两个渠道已能独立验收整条业务链路。

## 2. Trafilatura：真实侧车 + defuddle 兜底

规格要求 Trafilatura 作为主提取器。npm 上的 `trafilatura@0.2` 是 `napi-rs-trafilatura` 原生绑定，
无法在可移植 JS 运行时使用，因此：

- 真实 Trafilatura 以 Python 侧车提供（`services/extractor`），通过 `TRAFILATURA_URL` 接入；
- 未配置时使用 `defuddle`（同类精度优先提取器）；
- 两者共用同一个 `Extractor` 接口，60% 择优规则与元数据合并逻辑不变。

已在本机验证：Python 3.15.0 + trafilatura 2.3.1，维基百科页面走该通道输出 41875 字并正确合并元数据。

## 3. 放行 `198.18.0.0/15`

本机 DNS 会把所有域名解析到 `198.18.x.x`（基准测试段，常见于企业/沙箱透明 DNS）。
若拦截该段，任何抓取都无法工作，故放行；RFC1918、回环、链路本地、CGNAT、云元数据地址仍然拦截。
残余风险：DNS 重绑定（解析与连接之间换地址）无法在纯 fetch 下完全消除，已在 `url-guard.ts` 注释中标注。

## 4. 微信公众号

- 优先原生解析 `#js_content`，失败后转 Jina。
- 页面可能是"环境异常 / 内容已删除"等风控或失效页：两类通道都做标记检测，命中则按失败处理，
  绝不把验证页当正文返回。
- 发布时间优先取 `#publish_time`，缺失时解析页面内 `var ct` 时间戳。
- 首图来自 `mmbiz.qpic.cn`，Telegram `sendPhoto` 失败时会自动退回文本消息。

## 5. GitHub：REST 而非 DeepWiki

实测 `deepwiki.com` 从本机返回 429，且需要页面级抓取。默认改用 GitHub REST（仓库元数据 + README），
匿名额度 60 次/小时，可用 `GITHUB_TOKEN` 提升。`DEEPWIKI_ENABLED` 保留为关闭的开关。

## 6. X：免密钥 FxEmbed 风格接口

`api.fxtwitter.com` 为主、`api.vxtwitter.com` 为备；无图时 OG 回落到 favicon。
这是第三方公共接口，稳定性和限额不受本项目控制，已做双通道降级与统一错误文案。

## 7. RLS 与授权

按规格对 `fetch_history` / `ai_results` / `archive_records` 开放匿名与登录读写——历史是共享工具记录。
`api_tokens`、`telegram_bindings`、`telegram_logs`、`platform_sessions`、`app_settings`、`rate_limit_counters`
启用 RLS 且不创建策略、不授予 `anon/authenticated` 任何权限，仅服务端角色可访问。

注意：PGlite 与 Supabase 都要求显式 `GRANT` 后策略才生效，迁移 0002 已包含 `grant usage on schema public`
与三张业务表的 `select/insert/update`。在 Supabase 上请使用 service role 连接服务端。

## 8. Telegram 绑定

默认要求 `/bind <TELEGRAM_BIND_CODE>`，而不是 `/start` 自动绑定——否则任何发现 Bot 的人都能使用。
也可用 `TELEGRAM_ALLOWED_CHAT_IDS` 白名单直接放行。绑定尝试 5 次/10 分钟限流，比较使用恒定时间函数。

## 9. 限频表与限频实现

规格只列了业务表，但"请求频率上限"需要原子计数，新增 `rate_limit_counters` + `bump_rate_limit()` SQL 函数
（纯 SQL 实现，不依赖 plpgsql 扩展）。API 按令牌、历史按 IP、Bot 按会话，分钟 + 小时双窗口。

## 10. 免费额度与降级

- 抓取顺序：自建 → Jina →（已配置的）付费引擎。付费引擎本轮只保留 `isConfigured()` 与统一接口，
  未接线时不出现在链路里，也不报错。
- 60 秒内存结果缓存只用于合并同一 URL 的并发/重复抓取以节省免费额度；每次请求仍会写入一条历史记录。
- AI 免费模型优先，`models` 数组让 OpenRouter 自行回落；失败只影响 AI 区块。

## 11. 统一 JSON 的扩展字段

除规格字段外，增加了 `id`、`created_at`（落库与前端关联必需），以及按需出现的 `ai`、`archives`。
核心字段名称、类型与语义保持不变。

## 12. 抓取上限

- 页面 ≤ 8MB（流式截断），正文 ≤ 60000 字符（超出追加"已截断"提示）。
- 单跳超时 15 秒，Jina 20 秒，总重定向 ≤ 3 次且每跳重新做 SSRF 校验。
- 请求体 ≤ 64KB；原始 HTML 入库前截断到 2MB；原始 HTML 永不出现在公开响应。

## 13. 文档页

`/api/docs` 由服务端直接返回单文件 HTML（无构建、无 CDN、无密钥），便于在只有 API 服务的环境里也能查看。
配色为 zinc/slate 深色 + emerald 强调色，未使用紫色系；图标为内联 Lucide 路径。

## 14. 平台登录态

`platform_sessions` 表已建、AES-256-GCM 加密字段保留在配置项中，但本轮没有写入方——
小红书/微博/知乎的浏览器渲染通道延后，避免交付一个无法维护的半成品。

## 15. 全文检索：FTS + CJK 子串回退

- 索引：`fetch_history.search_vector` 为生成列（`simple` 配置，标题 A / 正文 B / URL C），GIN 索引。
  选 `simple` 而不是 `english`，避免中文与代码片段被英文词干化破坏。
- 英文/数字查询用 `websearch_to_tsquery` + `ts_rank_cd`；**零命中时自动回退子串匹配**，
  避免单复数、连字符等词形差异导致"明明有却搜不到"。
- 中文/日文/韩文没有内置分词器（`zhparser`/`pg_jieba` 需要额外编译扩展，PGlite 不可用），
  使用转义后的 `ILIKE` 子串匹配，并按命中位置排序：标题 > URL > 正文。
- `%` 与 `_` 被转义为字面量，防止用户输入变成通配符扫描。
- 分页使用 `limit`/`offset`（上限 50 / 1000）并返回 `next_offset`；空结果仍返回准确的 `total`。
- 本轮索引范围是标题、正文、URL、作者、站点名；**AI 摘要与标签尚未纳入索引**（它们存于 `ai_results`，
  需要跨表聚合或物化字段，留待网站主界面阶段一起做）。
- 数据量到万级后建议：为 CJK 增加 `pg_trgm` GIN 索引，或引入带分词器的 Postgres 镜像。

