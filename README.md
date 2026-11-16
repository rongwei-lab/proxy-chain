# 代理编辑工具 (Proxy Editor)

多来源代理节点归一化、可视化多跳串联编排与 Clash / Mihomo 规则分流配置生成工具。

## 核心能力

- **多来源归一化节点库**：支持同时追加导入多个订阅 URL、批量粘贴节点链接 / Clash YAML 片段，以及 VLESS / SOCKS5 / Hysteria2 / Shadowsocks 手动表单录入。
- **各层直接添加与导入**：在入口、出口节点卡片中手动新增，或导入订阅、节点链接、YAML 与本地文件；有效节点去重后自动选入当前层，保留已有选择。
- **连接语义去重**：按协议类型、服务器、端口、认证凭据、TLS / Reality 与传输层等完整连接参数计算稳定指纹，避免同服务器不同账号被误合并，支持同连接多来源聚合、别名重命名与来源删除影响预览/撤销。
- **灵活的链式编排（简洁模式 + 高级多跳）**：
  - 独立开关 **使用独立出口**：启用时支持 `入口 → ... → 独立出口` 通过 Clash `dialer-proxy` 串联；关闭时保留原有选择以便恢复，但不参与校验、预览与导出。
  - **高级模式** 支持新增、启用/停用、拖拽与上下移排序多个中转层（活跃上限 5 层），切回简洁模式保留中转配置但不纳入导出。
  - 每层支持 `select`、`url-test` 与 `fallback` 选路策略，并带探活参数校验与出口自动切换 IP 提示。
- **分流模板与多方案隔离**：
  - 内置 `cn-direct`、`all-proxy` 与可排序 `custom` 自定义域名规则，支持将不同域名路由到同一 workspace 内的不同代理方案、`DIRECT` 或 `REJECT`。
  - 多方案导出前执行统一不可变快照校验，阻断同链路循环、HY2 无 UDP 上游等风险组合，确保节点/策略组名称零冲突。
- **配置导出与客户端导入**：
  - **完整 Mihomo 配置**：含基础 `dns`（`fake-ip`）与完整 `proxies` / `proxy-groups` / `rules`。
  - **临时导入链接**：按需上传完整配置，生成 600 秒有效的 Clash / Mihomo 导入链接。
  - **客户端使用帮助**：保留 v2rayN 手动配置指南与客户端兼容说明。
- **显式本地保存与方案 JSON 导入/导出**：默认不自动读写 `localStorage`；支持 `schemaVersion: 1` 结构导出（默认不含 UUID / 密码等凭据，可选勾选附带凭据并提示明文风险）。

## 安全、存储与客户端边界说明

- **默认本地内存运行**：节点解析、拓扑编排与本地复制/下载均在浏览器内存中完成。仅在主动拉取远程订阅或主动生成 Clash 临时导入链接时才会发起网络请求。
- **同源能力探测 (`/api/healthz`)**：页面会严格校验 JSON 身份标识（`mode: 'worker-app'`, `apiVersion: 1`）与能力开关；若部署为纯静态站点（如 Vite / GitHub Pages 返回 HTML 200 回退），会自动降级禁用云端临时链接生成，同时保留所有本地解析与导出功能。
- **Clash 临时导入存储机制 (`/api/clash-config`)**：
  - `cloudflare/app-worker.js` 使用绑定至 SQLite 的 Durable Object（`TemporaryClashConfigStore`，在 `cloudflare/app-wrangler.toml` 中通过 `[[durable_objects.bindings]]` 与 `[[migrations]] new_sqlite_classes` 声明）替代仅限单数据中心内存的 `caches.default`，从而实现跨边缘节点与跨请求一致读取。
  - 每次写入生成 192-bit 随机 ID，限制 `POST` 请求体 ≤ 2 MiB，绝对访问有效期为 **600 秒**（不因读取而续期），响应头强制 `Cache-Control: no-store`。
  - **隐私与保留声明**：生成临时链接会上传完整导出 YAML（含服务器地址与节点凭据），任何持有链接者在 600 秒有效期内均可读取；同时，Cloudflare Durable Object SQLite 平台内置的 PITR（Point-in-Time Recovery）备份保留机制可能保留历史数据最长 30 天。若介意云端临时托管，请直接使用本地“复制配置”或“下载文件”。
- **订阅拉取代理与 SSRF 防护**：
  - `server/subscription-fetcher.mjs`（Node 服务）与 `cloudflare/subscription-fetcher-core.js` 共享 `shared/ssrf-guard.mjs`，限制仅 `http:`/`https:`、支持主机白名单、手动追踪重定向（默认最多 5 跳，逐跳复检并拦截回路）、拦截内网/环回/链路本地/保留网段 IPv4/IPv6 与 IPv4 映射地址、单次请求总超时与 2 MiB 流式响应上限，且不向上游透传鉴权令牌。
  - **运行环境差异**：Node 端拉取服务通过自定义 `lookup` 将已校验 DNS 解析 IP 绑定至底层 Socket（同时保留原 `Host` 与 TLS SNI/证书校验），可防 DNS Rebinding；Cloudflare Workers 运行时由平台托管 `fetch()` 出站连接，无法通过 JS Hook 将前置 DNS 结果绑定到 socket。
- **客户端兼容性**：
  - 配置优先面向 **Mihomo (Clash Meta)** 内核设计。
  - **v2rayN** 入口当前仅定位为“手动前置代理配置指引”与兼容场景下的参考 Xray Outbounds，非一键多跳订阅导入。
  - **Shadowrocket** 链式 Clash 导入功能尚未在本轮通过真实设备与真实节点完成验证，使用前请在实机自行测试确认。

## 本地开发与校验

```bash
npm install
npm run dev          # 启动本地前端开发服务器
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint 检查
npm run test         # 运行全部前端单元、UI 交互、Node 与 Cloudflare Workers 测试
npm run test:backend # 仅运行 Node fetcher 与 Miniflare Worker 集成测试
npm run build        # 构建 dist/ 生产静态产物（使用相对路径 ./ 支持 / 或 /proxy-chain/ 子路径托管）
```

### 运行 Node 订阅拉取服务

可参考 `.env.fetcher.example`（请勿将真实的 `.env.fetcher` 提交至仓库）：

```bash
ALLOWED_ORIGINS="http://localhost:5173" \
ALLOWED_SUBSCRIPTION_HOSTS="sub.example.com" \
FETCH_TOKEN="replace-with-random-token" \
npm run fetcher
```

### Cloudflare Worker 本地验证 / 部署配置参考

- 主应用 Worker（含静态资源与 `/api/healthz`、`/api/clash-config`、可选 Service Binding 订阅代理）：[cloudflare/app-wrangler.toml](file:///Users/wei/Documents/code/代理节点/proxy-chain/cloudflare/app-wrangler.toml)
- 独立订阅拉取 Worker：[cloudflare/wrangler.toml](file:///Users/wei/Documents/code/代理节点/proxy-chain/cloudflare/wrangler.toml) 与 [cloudflare/.dev.vars.example](file:///Users/wei/Documents/code/代理节点/proxy-chain/cloudflare/.dev.vars.example)

```bash
npx wrangler deploy --config cloudflare/app-wrangler.toml --dry-run
npx wrangler deploy --config cloudflare/wrangler.toml --dry-run
```
