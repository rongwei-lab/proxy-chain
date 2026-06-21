# proxy-chain

proxy-chain 是一个运行在浏览器本地的链式代理配置辅助工具。它面向需要整理、拼接或转换代理节点配置的用户，目标是把输入的代理信息在前端完成解析和导出，方便后续导入到真实客户端中使用。

## 项目定位

- 本项目只负责生成和展示代理配置文本，不提供代理服务器、订阅服务或中转节点。
- 所有处理逻辑默认在浏览器端完成，适合部署为静态站点，例如 GitHub Pages。
- 仓库内不得提交真实节点、真实订阅地址、真实 UUID、密码、密钥或个人可识别信息。

## 支持格式

当前设计面向常见 URI 或配置片段，建议示例和测试都使用脱敏占位符：

- VLESS Reality：`vless://00000000-0000-0000-0000-000000000000@203.0.113.10:443?encryption=none&security=reality&sni=www.example.com&fp=chrome&pbk=REDACTED&type=tcp#entry`
- SOCKS5：`socks5://demo:REDACTED@198.51.100.14:1193#exit`
- Hysteria2 YAML 片段：支持 `name/type/server/port/password/sni/skip-cert-verify/udp` 等字段。
- Mihomo/Clash 订阅内容：支持解析顶层 `proxies` 数组中的 `vless`、`socks5`、`hysteria2` 节点。

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
