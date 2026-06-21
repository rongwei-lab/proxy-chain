# proxy-chain

proxy-chain 是一个运行在浏览器本地的链式代理配置辅助工具。它面向需要整理、拼接或转换代理节点配置的用户，目标是把输入的代理信息在前端完成解析和导出，方便后续导入到真实客户端中使用。

## 项目定位

- 本项目只负责生成和展示代理配置文本，不提供代理服务器或中转节点。
- 所有解析和导出逻辑默认在浏览器端完成，适合部署为静态站点，例如 GitHub Pages。
- 如订阅服务不允许浏览器跨域读取，可选择部署仓库内的轻量订阅拉取服务，由你自己的服务器代为读取订阅文本。
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
- 自建订阅拉取服务只在用户点击“拉取订阅”后请求指定订阅 URL；服务端必须配置访问令牌和允许域名，避免变成公开代理。
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
```

`npm run preview` 用于本地预览生产构建结果。因为 GitHub Pages 部署路径是 `/proxy-chain/`，Vite 已在 `vite.config.ts` 中配置 `base: '/proxy-chain/'`。

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

## 自建订阅拉取服务

GitHub Pages 是静态站点，页面直接请求订阅地址时经常会被浏览器 CORS 策略拦截。解决办法是在自己的服务器上部署 `server/subscription-fetcher.mjs`，由服务器读取订阅内容，再返回给页面。

### 运行方式

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
