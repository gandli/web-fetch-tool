import type { AppConfig } from "./config.ts";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Self-contained API documentation page. No build step, no CDN, no secrets:
 * dark developer-tool styling with Lucide icons (zinc/slate + emerald accents).
 */
export function docsPage(config: AppConfig): string {
  const base = esc(config.publicBaseUrl);
  const curlFetch = `curl -s ${base}/api/fetch \\
  -H "Authorization: Bearer $WEB_FETCH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`;
  const curlAi = `curl -s ${base}/api/ai \\
  -H "Authorization: Bearer $WEB_FETCH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"<fetch_id>","task":"summarize","summary_length":"medium"}'`;
  const curlArchive = `curl -s ${base}/api/archive \\
  -H "Authorization: Bearer $WEB_FETCH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"<fetch_id>","channels":["telegraph"]}'`;
  const curlHistory = `curl -s "${base}/api/history?limit=20"`;
  const curlHealth = `curl -s ${base}/api/health`;
  const telegramSetup = `# 1. 设置环境变量
TELEGRAM_BOT_TOKEN=...        # @BotFather 获取
TELEGRAM_WEBHOOK_SECRET=...   # 随机字符串，>= 16 位
TELEGRAM_BIND_CODE=...        # 绑定码，>= 8 位

# 2. 注册 webhook（需要公网 HTTPS 地址）
bun run tg:set-webhook --url https://your-domain/telegram/webhook`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
<title>Web Fetch API · 文档</title>
<meta name="description" content="多渠道网页内容抓取、加工与存档 API 文档" />
<style>
  :root {
    --bg: #0a0e12; --panel: #10161c; --panel-2: #0d1319; --border: #1e2a33;
    --text: #dbe5ee; --muted: #8ea0b0; --accent: #34d399; --accent-dim: #0f3d2e;
    --blue: #60a5fa; --amber: #fbbf24; --red: #f87171;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    --sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.6; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .layout { display: grid; grid-template-columns: 248px minmax(0, 1fr); min-height: 100vh; }
  aside { border-right: 1px solid var(--border); padding: 22px 16px; position: sticky; top: 0; height: 100vh; overflow: auto; background: var(--panel-2); }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .2px; }
  .brand .dot { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 12px rgba(52,211,153,.55); }
  .brand small { display: block; color: var(--muted); font-weight: 500; font-size: 11px; letter-spacing: .8px; text-transform: uppercase; }
  nav { margin-top: 26px; display: flex; flex-direction: column; gap: 2px; }
  nav a { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 7px; color: var(--muted); font-size: 13.5px; }
  nav a:hover { color: var(--text); background: #141d24; text-decoration: none; }
  nav svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.8; }
  main { padding: 34px 40px 90px; max-width: 1040px; }
  header.page h1 { font-size: 30px; line-height: 1.25; margin: 0 0 8px; letter-spacing: -.3px; }
  header.page p { color: var(--muted); margin: 0; max-width: 720px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: #0f1a17; color: var(--accent); border-radius: 999px; padding: 3px 10px; font-size: 12px; margin-top: 14px; }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  section { margin-top: 40px; scroll-margin-top: 20px; }
  section > h2 { font-size: 19px; margin: 0 0 6px; display: flex; align-items: center; gap: 9px; }
  section > h2 svg { width: 18px; height: 18px; stroke: var(--accent); fill: none; stroke-width: 1.8; }
  section > p.lede { color: var(--muted); margin: 0 0 14px; font-size: 14px; }
  .endpoint { border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .endpoint .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .method { font-family: var(--mono); font-size: 11.5px; font-weight: 700; letter-spacing: .4px; padding: 2px 8px; border-radius: 6px; }
  .get { color: #93c5fd; background: #10233a; border: 1px solid #1d3a5c; }
  .post { color: #6ee7b7; background: #0d2a22; border: 1px solid #1b4738; }
  .path { font-family: var(--mono); font-size: 14px; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 4px; }
  pre { position: relative; background: #080c10; border: 1px solid var(--border); border-radius: 9px; padding: 14px 16px; overflow: auto; margin: 12px 0 0; }
  pre code { font-family: var(--mono); font-size: 12.8px; color: #cfe3f3; white-space: pre; }
  .copy { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 5px; background: #131c23; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
  .copy:hover { color: var(--text); border-color: #2c3d4a; }
  .copy svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  td code, p code, li code { font-family: var(--mono); font-size: 12.4px; background: #131c23; border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  .note { border-left: 3px solid var(--amber); background: #191407; color: #f3d79b; padding: 10px 14px; border-radius: 0 8px 8px 0; font-size: 13px; margin-top: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
  .card { border: 1px solid var(--border); background: var(--panel); border-radius: 10px; padding: 14px; }
  .card h3 { margin: 0 0 4px; font-size: 14px; }
  .card p { margin: 0; color: var(--muted); font-size: 13px; }
  .searchbar { display: flex; gap: 8px; margin-top: 12px; }
  .searchbar input { flex: 1; background: #080c10; border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 8px; font-size: 14px; outline: none; }
  .searchbar input:focus { border-color: #2f5e4c; box-shadow: 0 0 0 2px rgba(52,211,153,.15); }
  .searchbar button { background: var(--accent-dim); color: var(--accent); border: 1px solid #1b4738; padding: 0 16px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  .searchbar button:hover { background: #12503c; }
  .search-results { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
  .search-item { border: 1px solid var(--border); background: var(--panel); border-radius: 9px; padding: 12px 14px; }
  .search-item h3 { margin: 0 0 4px; font-size: 14.5px; }
  .search-item h3 a { color: var(--text); }
  .search-item h3 a:hover { color: var(--accent); text-decoration: none; }
  .search-item .meta { color: var(--muted); font-size: 12px; margin-bottom: 6px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .search-item p { margin: 0; font-size: 13px; color: #b9c7d4; }
  .search-item mark { background: #14432f; color: #6ee7b7; padding: 0 2px; border-radius: 3px; }
  .badge { border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; font-size: 11px; color: var(--muted); }
  footer { margin-top: 60px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); padding-top: 16px; }
  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
    aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
    nav { flex-direction: row; flex-wrap: wrap; }
    main { padding: 24px 18px 60px; }
  }
</style>
</head>
<body>
<div class="layout">
  <aside>
    <div class="brand"><span class="dot"></span><div>Web Fetch<small>API Reference</small></div></div>
    <nav>
      <a href="#overview"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>概览</a>
      <a href="#search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>全文检索</a>
      <a href="#auth"><svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8M17 5l3 3M14 8l3 3"/></svg>鉴权</a>
      <a href="#fetch"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 15 3 3-3 3"/></svg>抓取</a>
      <a href="#ai"><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/></svg>AI 加工</a>
      <a href="#archive"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>存档</a>
      <a href="#history"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>历史</a>
      <a href="#telegram"><svg viewBox="0 0 24 24"><path d="m22 3-10 9M22 3l-7 18-4-8-8-4z"/></svg>Telegram</a>
      <a href="#errors"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>错误码</a>
    </nav>
  </aside>

  <main>
    <header class="page">
      <h1>网页抓取、加工与存档 API</h1>
      <p>提交一个 URL，服务端完成平台识别、免费优先抓取、正文净化、OG 提取与可选 AI 处理，返回统一 JSON。四个入口渠道（网站、扩展、Telegram、API）共用同一条流水线。</p>
      <span class="pill"><span class="dot"></span>v0.1 · 本地开发版本</span>
    </header>

    <section id="overview">
      <h2><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>统一返回结构</h2>
      <p class="lede">除 <code>id</code> 与 <code>created_at</code> 外，字段与模块定义保持一致。</p>
      <pre><code>{
  "id": "uuid",
  "created_at": "2026-10-19T01:00:00.000Z",
  "provider": "self | jina | fxtwitter | wechat-native | github-api",
  "url": "https://...",
  "title": "...",
  "platform": "web | x | wechat | xiaohongshu | weibo | zhihu | github",
  "content": { "format": "markdown", "text": "...", "length": 1234 },
  "metadata": { "author": null, "published_at": null, "language": null },
  "og": { "image": null, "title": null, "description": null, "site_name": null },
  "usage": { "fetch_cost_usd": 0 },
  "metrics": { "response_time_ms": 0, "upstream_latency_ms": 0 },
  "status": "ok | partial | failed"
}</code></pre>
      <div class="note">免费链路（自建抓取、Jina Reader、Telegraph、X 与微信公众号专项通道）无需任何密钥即可使用；缺失的付费能力会自动跳过。</div>
      <div class="grid">
        <div class="card"><h3>平台识别</h3><p>X、微信公众号、GitHub 走专项通道；普通网页走多引擎降级链。</p></div>
        <div class="card"><h3>正文净化</h3><p>精度提取器与 Readability 并行，按 60% 规则择优，统一转 Markdown。</p></div>
        <div class="card"><h3>OG 降级</h3><p>og:image → 首张正文大图 → favicon → 占位图。</p></div>
      </div>
    </section>

    <section id="search">
      <h2><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>全文检索</h2>
      <p class="lede">搜索已存档记录的标题与正文。英文走 Postgres 全文索引（标题权重最高），中文自动切换子串匹配，无需分词插件。</p>
      <div class="searchbar">
        <input id="search-input" type="search" placeholder="例如：markdown / 浏览器 / Telegram" autocomplete="off" />
        <button id="search-button" type="button">搜索</button>
      </div>
      <p class="hint" id="search-meta">匿名可读，按 IP 限频；数据库为空时没有结果。</p>
      <div id="search-results" class="search-results"></div>
      <pre><code>${esc(`curl -s "${base}/api/search?q=markdown&limit=10"`)}</code></pre>
    </section>

    <section id="auth">
      <h2><svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8M17 5l3 3M14 8l3 3"/></svg>鉴权</h2>
      <p class="lede">写入类接口需要令牌。令牌只在服务端以 <code>sha256</code> 摘要保存，创建时仅显示一次。</p>
      <pre><code>bun run token:create -- --name "my-script" --scopes fetch,ai</code></pre>
      <p class="hint">请求头可用 <code>Authorization: Bearer &lt;token&gt;</code> 或 <code>X-API-Key: &lt;token&gt;</code>。历史查询为只读共享记录，无需令牌。</p>
    </section>

    <section id="fetch">
      <h2><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 15 3 3-3 3"/></svg>抓取</h2>
      <div class="endpoint">
        <div class="row"><span class="method post">POST</span><span class="path">/api/fetch</span></div>
        <div class="hint">抓取并落库。参数：<code>url</code>（必填）、<code>engine</code>（可选，默认 auto）、<code>ai</code>（可选）、<code>archive</code>（可选）。</div>
      </div>
      <pre><code>${esc(curlFetch)}</code></pre>
      <pre><code>// 带 AI 与存档
{"url":"https://example.com","ai":{"summary":true,"tags":true,"language":"zh"},"archive":{"channels":["telegraph"]}}</code></pre>
      <table>
        <tr><th>字段</th><th>说明</th></tr>
        <tr><td><code>engine</code></td><td><code>auto</code> / <code>self</code> / <code>jina</code> / <code>fxtwitter</code> / <code>wechat-native</code> / <code>github-api</code></td></tr>
        <tr><td><code>ai.summary</code></td><td>生成摘要，长度默认 medium</td></tr>
        <tr><td><code>ai.tags</code></td><td>生成 3–8 个标签</td></tr>
        <tr><td><code>ai.analyze</code></td><td>结构化阅读卡片</td></tr>
        <tr><td><code>archive.channels</code></td><td><code>telegraph</code> / <code>internet-archive</code></td></tr>
      </table>
    </section>

    <section id="ai">
      <h2><svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/></svg>AI 加工</h2>
      <div class="endpoint">
        <div class="row"><span class="method post">POST</span><span class="path">/api/ai</span></div>
        <div class="hint">任务：<code>translate</code> / <code>summarize</code> / <code>titles</code> / <code>tags</code> / <code>analyze</code>。传 <code>id</code> 复用已有抓取，或传 <code>url</code> 先抓取再处理。</div>
      </div>
      <pre><code>${esc(curlAi)}</code></pre>
      <p class="hint">未配置 <code>OPENROUTER_API_KEY</code> 时返回 <code>ai_not_configured</code>，不影响抓取、存档与历史。</p>
    </section>

    <section id="archive">
      <h2><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/></svg>存档</h2>
      <div class="endpoint">
        <div class="row"><span class="method post">POST</span><span class="path">/api/archive</span></div>
        <div class="hint">对已有记录补存档，成功链接会写入 <code>archive_records</code> 并在历史详情中返回。</div>
      </div>
      <pre><code>${esc(curlArchive)}</code></pre>
      <p class="hint">Telegraph 免密钥可用；Internet Archive 的 Save Page Now 不支持 X/Twitter 域名，会自动跳过。</p>
    </section>

    <section id="history">
      <h2><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>历史与健康检查</h2>
      <div class="endpoint">
        <div class="row"><span class="method get">GET</span><span class="path">/api/history?limit=20&amp;before=&lt;cursor&gt;</span></div>
        <div class="hint">共享历史记录，匿名可读，按创建时间倒序游标分页。</div>
      </div>
      <div class="endpoint">
        <div class="row"><span class="method get">GET</span><span class="path">/api/history/{id}</span></div>
        <div class="hint">单条记录详情，包含 Markdown 正文、AI 结果与存档链接。</div>
      </div>
      <pre><code>${esc(curlHistory)}</code></pre>
      <div class="endpoint">
        <div class="row"><span class="method get">GET</span><span class="path">/api/health</span></div>
        <div class="hint">数据库与各能力配置状态，不返回任何密钥。</div>
      </div>
      <pre><code>${esc(curlHealth)}</code></pre>
    </section>

    <section id="telegram">
      <h2><svg viewBox="0 0 24 24"><path d="m22 3-10 9M22 3l-7 18-4-8-8-4z"/></svg>Telegram Bot</h2>
      <p class="lede">发送网址自动处理；指令控制语言、翻译、存档与摘要长度。仅绑定对话可用，单对话限频。</p>
      <pre><code>${esc(telegramSetup)}</code></pre>
      <table>
        <tr><th>指令</th><th>作用</th></tr>
        <tr><td><code>/start</code> <code>/help</code></td><td>状态与指令帮助</td></tr>
        <tr><td><code>/bind &lt;code&gt;</code></td><td>绑定当前对话（绑定码由服务端配置）</td></tr>
        <tr><td><code>/lang zh</code></td><td>设置输出语言</td></tr>
        <tr><td><code>/translate on|off</code></td><td>翻译开关</td></tr>
        <tr><td><code>/archive on|off</code></td><td>存档开关</td></tr>
        <tr><td><code>/summary short|medium|long</code></td><td>摘要长度</td></tr>
      </table>
    </section>

    <section id="errors">
      <h2><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>错误码</h2>
      <p class="lede">错误响应形如 <code>{"error":{"code":"...","message":"..."}}</code>，不包含堆栈、上游响应或内部细节。</p>
      <table>
        <tr><th>HTTP</th><th>code</th><th>说明</th></tr>
        <tr><td>400</td><td><code>invalid_url</code> / <code>blocked_url</code></td><td>链接格式错误或不允许访问（含内网与元数据地址）</td></tr>
        <tr><td>401 / 403</td><td><code>unauthorized</code> / <code>forbidden</code></td><td>令牌缺失、无效或权限不足</td></tr>
        <tr><td>404</td><td><code>not_found</code></td><td>记录不存在</td></tr>
        <tr><td>415</td><td><code>unsupported_content</code></td><td>非文本内容</td></tr>
        <tr><td>422</td><td><code>content_empty</code> / <code>platform_experimental</code></td><td>未提取到正文，或平台暂未开放</td></tr>
        <tr><td>429</td><td><code>rate_limited</code> / <code>ai_rate_limited</code></td><td>请求过于频繁</td></tr>
        <tr><td>503</td><td><code>ai_not_configured</code> / <code>archive_not_configured</code></td><td>对应能力尚未配置</td></tr>
      </table>
    </section>

    <footer>接口基址 ${base} · 字段说明见 <a href="${base}/api/health">/api/health</a> · 密钥仅存服务端</footer>
  </main>
</div>
<script>
  document.querySelectorAll('pre').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy';
    btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>复制';
    btn.addEventListener('click', function () {
      var text = pre.querySelector('code').innerText;
      var done = function () { btn.textContent = '已复制'; setTimeout(function () { btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>复制'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done); }
      else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
    });
    pre.appendChild(btn);
  });
</script>
<script>
(function () {
  var input = document.getElementById('search-input');
  var button = document.getElementById('search-button');
  var meta = document.getElementById('search-meta');
  var out = document.getElementById('search-results');
  if (!input || !button || !meta || !out) return;

  var escapeHtml = function (value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };
  var highlight = function (text, terms) {
    var html = escapeHtml(text);
    terms.forEach(function (term) {
      if (!term) return;
      var needle = escapeHtml(term);
      html = html.split(needle).join('<mark>' + needle + '</mark>');
    });
    return html;
  };
  var termsOf = function (query) {
    return query.split(/\s+/).filter(function (item) { return item.length > 0; });
  };

  var run = async function () {
    var query = input.value.trim();
    if (!query) {
      meta.textContent = '请输入关键词。';
      out.innerHTML = '';
      return;
    }
    meta.textContent = '搜索中…';
    out.innerHTML = '';
    try {
      var response = await fetch('/api/search?limit=10&q=' + encodeURIComponent(query));
      var body = await response.json();
      if (!response.ok) {
        meta.textContent = (body.error && body.error.message) ? body.error.message : '搜索失败。';
        return;
      }
      var terms = termsOf(query);
      meta.textContent = '共 ' + body.total + ' 条 · 模式 ' + body.mode + ' · ' + body.took_ms + 'ms';
      if (!body.items.length) {
        out.innerHTML = '<p class="hint">没有匹配的记录。</p>';
        return;
      }
      out.innerHTML = body.items.map(function (item) {
        return '<div class="search-item">'
          + '<h3><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noreferrer">' + highlight(item.title, terms) + '</a></h3>'
          + '<div class="meta"><span class="badge">' + escapeHtml(item.platform) + '</span>'
          + '<span class="badge">' + escapeHtml(item.provider) + '</span>'
          + '<span>' + escapeHtml(String(item.created_at).slice(0, 10)) + '</span></div>'
          + '<p>' + highlight(item.snippet, terms) + '</p>'
          + '</div>';
      }).join('');
    } catch (error) {
      meta.textContent = '搜索失败，请稍后重试。';
    }
  };

  button.addEventListener('click', run);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') run();
  });
})();
</script>
</body>
</html>`;
}

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0a0e12"/>
  <rect x="6" y="7" width="20" height="4" rx="2" fill="#34d399"/>
  <rect x="6" y="14" width="20" height="4" rx="2" fill="#60a5fa"/>
  <rect x="6" y="21" width="12" height="4" rx="2" fill="#8ea0b0"/>
</svg>`;

export const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Web Fetch">
  <rect width="1200" height="630" fill="#0a0e12"/>
  <rect x="24" y="24" width="1152" height="582" rx="24" fill="#10161c" stroke="#1e2a33"/>
  <circle cx="76" cy="76" r="8" fill="#34d399"/>
  <text x="104" y="83" fill="#8ea0b0" font-family="monospace" font-size="20" letter-spacing="4">WEB_FETCH</text>
  <text x="76" y="330" fill="#dbe5ee" font-family="monospace" font-size="64" font-weight="700">unified content</text>
  <text x="76" y="406" fill="#34d399" font-family="monospace" font-size="34">fetch -&gt; clean -&gt; og -&gt; ai -&gt; archive</text>
  <rect x="76" y="470" width="420" height="2" fill="#1e2a33"/>
  <text x="76" y="520" fill="#8ea0b0" font-family="monospace" font-size="20">multi-channel web content toolkit</text>
</svg>`;
