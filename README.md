# proxy-chain

proxy-chain 是一个运行在浏览器本地的链式代理配置辅助工具。它面向需要整理、拼接或转换代理节点配置的用户，目标是把输入的代理信息在前端完成解析和导出，方便后续导入到真实客户端中使用。

## 在线测试地址

- Cloudflare Workers 测试地址：[https://proxy-chain-app.rongweji.workers.dev](https://proxy-chain-app.rongweji.workers.dev)

## 项目定位

- 本项目只负责生成和展示代理配置文本，不提供代理服务器或中转节点。
- 所有节点解析和配置导出逻辑默认在浏览器端完成，适合部署为静态站点，例如 GitHub Pages。
- 如订阅服务不允许浏览器跨域读取，推荐部署 Cloudflare Workers 版本：公开 Worker 托管前端，内部 Worker 通过 Service Binding 拉取订阅文本。
- 仓库内不得提交真实节点、真实订阅地址、真实 UUID、密码、密钥或个人可识别信息。

## 支持格式

当前设计面向常见 URI 或配置片段，建议示例和测试都使用脱敏占位符：

- VLESS Reality：`vless://00000000-0000-0000-0000-000000000000@203.0.113.10:443?encryption=none&security=reality&sni=www.example.com&fp=chrome&pbk=REDACTED&type=tcp#entry`
- SOCKS5：`socks5://demo:REDACTED@198.51.100.14:1193#exit`
- Hysteria2 YAML 片段：支持 `name/type/server/port/password/sni/skip-cert-verify/udp` 等字段。
- Mihomo/Clash 订阅内容：支持解析顶层 `proxies` 数组中的 `vless`、`socks5`、`hysteria2`、`ss` 节点。

如果后续实现新增格式，请同步补充 README、测试用例和脱敏样例。

## 链式代理原理

链式代理是把多个代理节点按顺序串联起来，让流量依次经过入口节点、中间节点和出口节点。用户侧通常只连接到链路的第一个节点，后续转发关系由生成的客户端配置描述。

典型流程：

1. 解析用户粘贴的脱敏或本地代理节点配置。
2. 按用户选择的顺序组合入口、中继和出口。
3. 生成目标客户端可识别的配置片段。
4. 用户手动复制到自己的代理客户端中验证。

链路越长，延迟、故障概率和排障成本通常越高。生产使用前应逐段验证节点可用性。

## 隐私策略

- 应用不主动请求订阅 URL，不会在后台抓取、轮询或上传订阅内容。
- 应用不内置真实节点，不记录真实订阅地址、UUID、密码或访问密钥。
- 用户输入默认只在当前浏览器会话中处理；如后续新增本地存储、剪贴板、导入导出或网络请求能力，必须在界面和文档中明确说明。
- 订阅拉取服务只在用户点击“拉取订阅”后请求指定订阅 URL；内部 Worker 必须配置允许域名，避免变成公开拉取器。
- 文档、测试和演示数据必须使用 `example.invalid`、`REDACTED_*`、全零 UUID 等脱敏值。

## 本地运行

需要 Node.js 22.12 或更高版本，依赖通过 npm 管理。

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck
npm run test
npm run build
npm run preview
npm run fetcher
npm run cf:fetcher:deploy
npm run cf:app:deploy
```

`npm run preview` 用于本地预览生产构建结果。Vite 使用相对资源路径打包，同一份 `dist` 可以同时适配 GitHub Pages 的 `/proxy-chain/` 子路径和 Cloudflare Worker 的根路径。

## 推荐部署：Cloudflare Workers 前后端一体

这个方案用于“别人可以打开页面使用，但看不到内部拉取 Worker 地址和访问令牌”的场景：

```text
用户浏览器
  -> 公开 Worker 托管的前端页面
  -> 同源 /api/fetch-subscription
  -> Service Binding 调用内部 Worker
  -> 内部 Worker 拉取订阅文本
```

浏览器只能看到公开站点和 `/api/fetch-subscription`，不会拿到内部 Worker 的 `FETCH_TOKEN`。内部 Worker 仍保留旧的 HTTP token 接口，方便 GitHub Pages 或本地调试继续使用。

### 1. 配置内部订阅拉取 Worker

内部 Worker 文件位于 `cloudflare/subscription-fetcher-worker.js`，配置文件位于 `cloudflare/wrangler.toml`。

```toml
name = "proxy-chain-subscription-fetcher"
main = "subscription-fetcher-worker.js"
compatibility_date = "2026-06-21"
workers_dev = false

[vars]
FETCH_TIMEOUT_MS = "12000"
MAX_RESPONSE_BYTES = "2097152"
```

字段说明：

- `workers_dev = false`：关闭内部 Worker 的默认公网 `workers.dev` 地址；公开页面通过 Service Binding 调用它。
- `ALLOWED_ORIGINS`：旧 HTTP token 接口允许的网页来源；Service Binding 调用不依赖这个字段。建议在 Cloudflare Dashboard 或 Wrangler `--var` 中配置，不提交真实值。
- `ALLOWED_SUBSCRIPTION_HOSTS`：允许拉取的订阅域名，多个域名用英文逗号分隔。建议在 Cloudflare Dashboard 或 Wrangler `--var` 中配置，不提交真实值。
- `FETCH_TIMEOUT_MS`：拉取超时时间。
- `MAX_RESPONSE_BYTES`：最大订阅响应体，默认 2MB。

设置旧接口访问令牌。即使主要使用 Service Binding，也建议保留一个强随机令牌，避免旧接口裸奔：

```bash
npx wrangler secret put FETCH_TOKEN --config cloudflare/wrangler.toml
```

部署内部 Worker：

```bash
npm run cf:fetcher:deploy
```

首次部署或修改白名单时，可以用下面的方式把变量写到 Cloudflare，而不是写进仓库：

```bash
npx wrangler deploy --config cloudflare/wrangler.toml --keep-vars \
  --var ALLOWED_ORIGINS:https://example.com \
  --var ALLOWED_SUBSCRIPTION_HOSTS:update.example.com
```

### 2. 配置公开 App Worker

公开 Worker 文件位于 `cloudflare/app-worker.js`，配置文件位于 `cloudflare/app-wrangler.toml`。

```toml
name = "proxy-chain-app"
main = "app-worker.js"
compatibility_date = "2026-06-21"

[assets]
directory = "../dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

[[services]]
binding = "SUBSCRIPTION_FETCHER"
service = "proxy-chain-subscription-fetcher"
```

`service` 必须等于内部 Worker 的 `name`。如果你修改了内部 Worker 名称，这里也要同步修改。

部署公开 Worker：

```bash
npm run cf:app:deploy
```

页面部署成功后，前端会自动检测同源 `/api/healthz`。状态显示“同源服务可用”时，用户点击“拉取订阅”会走同源后端，不需要填写服务地址和 token。

同源 Worker 模式还支持“一键导入 Clash”。流程是：

1. 前端把当前生成的 Clash YAML 通过 `/api/clash-config` 发送给公开 Worker。
2. Worker 把配置放入 Cloudflare Cache，生成一个 10 分钟有效的临时短 URL。
3. 前端打开 `clash://install-config?url=<临时配置URL>`，由 Clash Verge/Clash 客户端拉取并导入配置。

这个临时配置不会写入仓库、KV、D1 或本地存储；但在有效期内，拿到短 URL 的客户端可以读取该配置。请不要把包含真实节点的导入链接公开分享。

### 3. 本地调试 Cloudflare Worker

内部 Worker：

```bash
cp cloudflare/.dev.vars.example cloudflare/.dev.vars
# 编辑 cloudflare/.dev.vars，写入本地测试 FETCH_TOKEN
npm run cf:fetcher:dev
```

公开 App Worker：

```bash
npm run cf:app:dev
```

本地 `wrangler dev` 使用 Service Binding 时，可能需要先让内部 Worker 处于可用状态，或按 Cloudflare Wrangler 的提示使用远程绑定。调试真实订阅时请始终使用脱敏日志，避免把订阅 URL、token、节点密码贴到终端或截图里。

## 部署到 GitHub Pages

本仓库包含 `.github/workflows/pages.yml`。当 `main` 分支收到 push 时，GitHub Actions 会执行：

1. `npm ci`
2. `npm run build`
3. 上传 `dist`
4. 使用 `actions/deploy-pages` 发布到 GitHub Pages

仓库首次启用 Pages 时，请在 GitHub 仓库设置中选择 GitHub Actions 作为 Pages 来源。部署完成后，站点路径通常为：

```text
https://<owner>.github.io/proxy-chain/
```

请不要把真实节点、真实订阅地址或密钥放入 README、Issue、PR、Actions 日志或部署产物中。

## 兼容方案：外部订阅拉取服务

GitHub Pages 是静态站点，页面直接请求订阅地址时经常会被浏览器 CORS 策略拦截。解决办法是在自己的服务器上部署 `server/subscription-fetcher.mjs`，由服务器读取订阅内容，再返回给页面。

推荐部署方式：

- Cloudflare Workers：不需要维护 VPS，适合轻量订阅拉取。
- VPS/Node：适合已经有服务器、Nginx、systemd 的场景。

### 单独部署 Cloudflare Workers 拉取器

Worker 文件位于 `cloudflare/subscription-fetcher-worker.js`，配置文件位于 `cloudflare/wrangler.toml`。

1. 登录 Cloudflare：

```bash
npx wrangler login
```

2. 修改 `cloudflare/wrangler.toml`：

```toml
name = "proxy-chain-subscription-fetcher"

[vars]
FETCH_TIMEOUT_MS = "12000"
MAX_RESPONSE_BYTES = "2097152"
```

字段说明：

- `ALLOWED_ORIGINS`：允许调用 Worker 的网页来源。线上 GitHub Pages 通常是 `https://<owner>.github.io`。建议通过 Cloudflare Dashboard 或 Wrangler `--var` 配置。
- `ALLOWED_SUBSCRIPTION_HOSTS`：允许 Worker 拉取的订阅域名，多个域名用英文逗号分隔。建议通过 Cloudflare Dashboard 或 Wrangler `--var` 配置。
- `FETCH_TIMEOUT_MS`：拉取超时时间。
- `MAX_RESPONSE_BYTES`：最大订阅响应体，默认 2MB。

3. 设置访问令牌。不要把真实令牌写进 `wrangler.toml`：

```bash
npx wrangler secret put FETCH_TOKEN --config cloudflare/wrangler.toml
```

4. 部署：

```bash
npm run cf:fetcher:deploy
```

部署完成后，Wrangler 会输出类似这样的 Worker 地址：

```text
https://proxy-chain-subscription-fetcher.<你的账号>.workers.dev
```

页面里填写：

- 服务地址：`https://proxy-chain-subscription-fetcher.<你的账号>.workers.dev/fetch-subscription`
- 访问令牌：第 3 步设置的 `FETCH_TOKEN`
- 模式：建议选择“自动”

本地开发 Worker：

```bash
cp cloudflare/.dev.vars.example cloudflare/.dev.vars
# 编辑 cloudflare/.dev.vars，写入本地测试 FETCH_TOKEN
npm run cf:fetcher:dev
```

Cloudflare Worker 版本同样会校验来源、访问令牌、订阅域名白名单，并拦截常见 localhost/内网 IP 字面地址。不要把 Worker 配成允许任意订阅域名，否则会变成公开拉取器。

### VPS/Node 运行方式

复制示例环境变量：

```bash
cp .env.fetcher.example .env.fetcher
```

编辑 `.env.fetcher`：

```env
PORT=8787
FETCH_TOKEN=请改成很长的随机字符串
ALLOWED_ORIGINS=https://rongwei-lab.github.io,http://127.0.0.1:5173
ALLOWED_SUBSCRIPTION_HOSTS=update.example.com
FETCH_TIMEOUT_MS=12000
MAX_RESPONSE_BYTES=2097152
```

字段说明：

- `FETCH_TOKEN`：页面访问服务时使用的 Bearer token，必须设置。
- `ALLOWED_ORIGINS`：允许调用服务的页面来源，线上通常填 `https://rongwei-lab.github.io`。
- `ALLOWED_SUBSCRIPTION_HOSTS`：允许拉取的订阅域名，多个域名用英文逗号分隔。
- `MAX_RESPONSE_BYTES`：最大订阅响应体，默认 2MB。

本地启动：

```bash
set -a
. ./.env.fetcher
set +a
npm run fetcher
```

健康检查：

```bash
curl http://127.0.0.1:8787/healthz
```

拉取测试：

```bash
curl -X POST http://127.0.0.1:8787/fetch-subscription \
  -H "content-type: application/json" \
  -H "authorization: Bearer $FETCH_TOKEN" \
  -d '{"url":"https://update.example.com/path/to/sub.yaml"}'
```

### systemd 示例

```ini
[Unit]
Description=proxy-chain subscription fetcher
After=network.target

[Service]
WorkingDirectory=/opt/proxy-chain
EnvironmentFile=/opt/proxy-chain/.env.fetcher
ExecStart=/usr/bin/npm run fetcher
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

### Nginx 反代示例

```nginx
server {
    listen 443 ssl http2;
    server_name fetch.example.com;

    location /fetch-subscription {
        proxy_pass http://127.0.0.1:8787/fetch-subscription;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /healthz {
        proxy_pass http://127.0.0.1:8787/healthz;
    }
}
```

部署后，在页面的“订阅拉取服务”里填写：

- 服务地址：`https://fetch.example.com/fetch-subscription`
- 访问令牌：`.env.fetcher` 中的 `FETCH_TOKEN`
- 模式：建议使用“自动”，先浏览器直连，失败后再用自建服务。

注意：不要把 `FETCH_TOKEN` 写进 GitHub 仓库、Issue、截图或公开日志。
