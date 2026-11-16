import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  PROTOCOL_CAPABILITY_MATRIX,
  createDefaultChainPlan,
  exportSelectedNodesAsLinks,
  generateClashYaml,
  loadSubscriptionContent,
  looksLikeHtmlDocument,
  parseProxyInputDetailed,
  parseYamlProxiesDetailed,
  probeSameOriginCapabilities,
  stringifyYamlConfig,
  toClashProxy,
  toImportLink,
  toXrayOutbound,
  upsertSourceNodes,
  validateAndExportPlan,
  validateNodeForFormat,
} from '../lib'

describe('M0 B01/B02/B05/B06 序列化、协议与能力校验', () => {
  it('T01: YAML 标量安全序列化不损坏前导零与特殊字符串并支持往返', () => {
    const yaml = stringifyYamlConfig({
      proxies: [
        {
          name: 'true',
          type: 'vless',
          server: 'vless.example.com',
          port: 443,
          uuid: '11111111-1111-4111-8111-111111111111',
          tls: true,
          network: 'tcp',
          'reality-opts': {
            'public-key': '001234',
            'short-id': '1e3',
          },
        },
        {
          name: 'node #hash: null false line',
          type: 'ss',
          server: 'ss.example.com',
          port: 8388,
          cipher: 'aes-256-gcm',
          password: '007 #secret: true\nnext',
        },
      ],
    })

    const reparsed = parseYaml(yaml) as {
      proxies: Array<Record<string, unknown>>
    }
    expect(typeof reparsed.proxies[0].name).toBe('string')
    expect(reparsed.proxies[0].name).toBe('true')
    expect((reparsed.proxies[0]['reality-opts'] as Record<string, unknown>)['public-key']).toBe('001234')
    expect((reparsed.proxies[0]['reality-opts'] as Record<string, unknown>)['short-id']).toBe('1e3')
    expect(reparsed.proxies[1].name).toBe('node #hash: null false line')
    expect(reparsed.proxies[1].password).toBe('007 #secret: true\nnext')
    expect(typeof reparsed.proxies[1].password).toBe('string')

    // 解析未加引号的 YAML 数字/布尔字符串字段应报错而不是静默转成 "12" / "true"
    const malformedYaml = `
proxies:
  - name: bad-numeric-short-id
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-4111-8111-111111111111
    tls: true
    network: tcp
    reality-opts:
      public-key: 123456
      short-id: 12
`
    const parsedMalformed = parseYamlProxiesDetailed(malformedYaml)
    expect(parsedMalformed.nodes).toHaveLength(0)
    expect(parsedMalformed.invalidCount).toBeGreaterThanOrEqual(1)
    expect(parsedMalformed.issues.some((issue) => issue.field === 'reality-opts.short-id' || issue.field === 'reality-opts.public-key')).toBe(true)
  })

  it('T02: VLESS Reality 参数（sid / pbk / sni / fp / spx）在 URI 与 Clash YAML 之间完整往返', () => {
    const uri =
      'vless://11111111-1111-4111-8111-111111111111@reality.example.com:443?security=reality&encryption=none&flow=xtls-rprx-vision&sni=cdn.example.com&fp=firefox&pbk=pubKey001&sid=0012ab&spx=%2Fedge&type=tcp#Reality-01'

    const parsedUri = parseProxyInputDetailed(uri)
    expect(parsedUri.validCount).toBe(1)
    const entryNode = parsedUri.nodes[0]
    expect(entryNode.type).toBe('vless')
    if (entryNode.type !== 'vless') {
      throw new Error('expected vless')
    }
    expect(entryNode.security).toBe('reality')
    expect(entryNode.sid).toBe('0012ab')
    expect(entryNode.pbk).toBe('pubKey001')
    expect(entryNode.spx).toBe('/edge')

    const clashProxy = toClashProxy(entryNode, 'Reality-01')
    expect(clashProxy.tls).toBe(true)
    expect(clashProxy['reality-opts']).toEqual({
      'public-key': 'pubKey001',
      'short-id': '0012ab',
    })

    const roundtripYaml = stringifyYamlConfig({ proxies: [clashProxy] })
    const parsedYaml = parseYamlProxiesDetailed(roundtripYaml)
    expect(parsedYaml.validCount).toBe(1)
    const roundtripNode = parsedYaml.nodes[0]
    expect(roundtripNode.type).toBe('vless')
    if (roundtripNode.type !== 'vless') {
      throw new Error('expected vless')
    }
    expect(roundtripNode.security).toBe('reality')
    expect(roundtripNode.sid).toBe('0012ab')
    expect(roundtripNode.pbk).toBe('pubKey001')

    const regeneratedUri = toImportLink(entryNode)
    expect(regeneratedUri).toContain('security=reality')
    expect(regeneratedUri).toContain('sid=0012ab')
    expect(regeneratedUri).toContain('pbk=pubKey001')
  })

  it('T03: 区分 VLESS none / tls / reality，保留 ws/grpc 传输并拒绝未知 transport 静默降级', () => {
    const tlsWsUri =
      'vless://11111111-1111-4111-8111-111111111111@ws.example.com:443?security=tls&sni=ws.example.com&alpn=h2,http/1.1&allowInsecure=1&type=ws&path=%2Fws&host=edge.example.com#VLESS-WS'
    const noneGrpcUri =
      'vless://22222222-2222-4222-8222-222222222222@grpc.example.com:8443?security=none&type=grpc&serviceName=tunSvc#VLESS-gRPC-None'
    const unsupportedXhttpUri =
      'vless://33333333-3333-4333-8333-333333333333@xhttp.example.com:443?security=tls&type=xhttp#Unsupported-XHTTP'

    const parsed = parseProxyInputDetailed(`${tlsWsUri}\n${noneGrpcUri}\n${unsupportedXhttpUri}`)
    expect(parsed.validCount).toBe(2)
    expect(parsed.unsupportedCount).toBe(1)

    const wsNode = parsed.nodes[0]
    const grpcNode = parsed.nodes[1]
    if (wsNode.type !== 'vless' || grpcNode.type !== 'vless') {
      throw new Error('expected vless nodes')
    }

    expect(wsNode.security).toBe('tls')
    expect(wsNode.skipCertVerify).toBe(true)
    expect(wsNode.wsOpts).toEqual({ path: '/ws', headers: { Host: 'edge.example.com' } })
    const wsClash = toClashProxy(wsNode, 'VLESS-WS')
    expect(wsClash.network).toBe('ws')
    expect(wsClash['skip-cert-verify']).toBe(true)
    expect(wsClash['ws-opts']).toEqual({ path: '/ws', headers: { Host: 'edge.example.com' } })

    expect(grpcNode.security).toBe('none')
    expect(grpcNode.grpcOpts).toEqual({ serviceName: 'tunSvc' })
    const grpcClash = toClashProxy(grpcNode, 'VLESS-gRPC-None')
    expect(grpcClash.tls).toBe(false)
    expect(grpcClash.network).toBe('grpc')
    expect(grpcClash['grpc-opts']).toEqual({ 'grpc-service-name': 'tunSvc' })

    const yamlWithUnknownNet = `
proxies:
  - name: Bad-Transport
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-4111-8111-111111111111
    tls: true
    network: xhttp
`
    const parsedYaml = parseYamlProxiesDetailed(yamlWithUnknownNet)
    expect(parsedYaml.nodes).toHaveLength(0)
    expect(parsedYaml.unsupportedCount).toBe(1)
  })

  it('T04: SS plugin、Hysteria2 完整参数、输入 dialer-proxy 剥离警告与 Xray 能力拒绝', () => {
    const ssUri =
      'ss://YWVzLTI1Ni1nY206cGFzczEyMzQ@ss.example.com:8388?plugin=v2ray-plugin%3Bmode%3Dwebsocket%3Btls%3Bhost%3Dcdn.example.com#SS-Plugin'
    const ssYaml = `
proxies:
  - name: HY2-Full
    type: hy2
    server: hy2.example.com
    port: 443
    password: hy2-password
    sni: cdn.hy2.example.com
    skip-cert-verify: true
    obfs: salamander
    obfs-password: obfs-secret
    up: 100 Mbps
    down: 300 Mbps
    ports: 40000-50000
    dialer-proxy: upstream-group
    extra-custom-field: unsupported-value
`
    const parsedSs = parseProxyInputDetailed(ssUri)
    const parsedHy2 = parseYamlProxiesDetailed(ssYaml)

    expect(parsedSs.validCount).toBe(1)
    const ssNode = parsedSs.nodes[0]
    expect(ssNode.type).toBe('ss')
    if (ssNode.type !== 'ss') {
      throw new Error('expected ss')
    }
    expect(ssNode.plugin).toBe('v2ray-plugin')
    expect(ssNode.pluginOpts?.mode).toBe('websocket')
    const ssClash = toClashProxy(ssNode, 'SS-Plugin')
    expect(ssClash.plugin).toBe('v2ray-plugin')

    expect(parsedHy2.validCount).toBe(1)
    expect(parsedHy2.warnings.some((w) => w.includes('dialer-proxy'))).toBe(true)
    expect(parsedHy2.warnings.some((w) => w.includes('extra-custom-field'))).toBe(true)

    const hy2Node = parsedHy2.nodes[0]
    expect(hy2Node.type).toBe('hysteria2')
    if (hy2Node.type !== 'hysteria2') {
      throw new Error('expected hy2')
    }
    expect(hy2Node.obfs).toBe('salamander')
    expect(hy2Node.obfsPassword).toBe('obfs-secret')
    expect(hy2Node.ports).toBe('40000-50000')
    expect(hy2Node.skipCertVerify).toBe(true)

    // Xray 不应静默吞掉 Hysteria2 或 unknown SS plugin
    expect(validateNodeForFormat(hy2Node, 'xray-json').some((d) => d.severity === 'error')).toBe(true)
    expect(() => toXrayOutbound(hy2Node, 'tag')).toThrow()
    expect(validateNodeForFormat(ssNode, 'xray-json').some((d) => d.severity === 'error')).toBe(true)

    // generateClashYaml 对已解析节点不应残留原始 input dialer-proxy
    const exported = generateClashYaml(ssNode, hy2Node)
    const parsedExport = parseYaml(exported) as { proxies: Array<Record<string, unknown>> }
    expect(parsedExport.proxies[0]['dialer-proxy']).toBeUndefined()
    expect(parsedExport.proxies[1]['dialer-proxy']).toBe('入口节点')
    expect(PROTOCOL_CAPABILITY_MATRIX.hysteria2.formats).not.toContain('xray-json')
  })

  it('T05: 连接语义去重：不同凭据不合并、同连接多源合并保留且改名不破坏引用', () => {
    const a1 = parseProxyInputDetailed(
      'socks5://user1:pass1@entry.example.com:1080#Node-A',
    ).nodes[0]
    const a2DiffCreds = parseProxyInputDetailed(
      'socks5://user2:pass2@entry.example.com:1080#Node-A-AltUser',
    ).nodes[0]
    const a1FromSecondSource = parseProxyInputDetailed(
      'socks5://user1:pass1@entry.example.com:1080#Node-A-Renamed',
    ).nodes[0]

    expect(a1.id).not.toBe(a2DiffCreds.id)
    expect(a1.id).toBe(a1FromSecondSource.id)
    expect(a1.id.includes('pass1')).toBe(false)
    expect(a1.id.includes('user1')).toBe(false)

    const merged1 = upsertSourceNodes(
      {},
      [],
      { id: 'src-1', name: 'Source 1', kind: 'paste', nodeIds: [], status: 'success' },
      [a1, a2DiffCreds],
    )
    const merged2 = upsertSourceNodes(
      merged1.registry,
      merged1.sources,
      { id: 'src-2', name: 'Source 2', kind: 'subscription', nodeIds: [], status: 'success' },
      [a1FromSecondSource],
    )

    expect(Object.keys(merged2.registry)).toHaveLength(2)
    expect(merged2.registry[a1.id].sourceIds).toEqual(['src-1', 'src-2'])
    expect(merged2.registry[a1.id].displayName).toBe('Node-A')

    // 移除第一个来源时，共用节点保留且 ID 不变
    const afterDeleteSrc1 = upsertSourceNodes(
      merged2.registry,
      merged2.sources,
      { id: 'src-1', name: 'Source 1', kind: 'paste', nodeIds: [], status: 'success' },
      [],
    )
    expect(afterDeleteSrc1.registry[a1.id]).toBeDefined()
    expect(afterDeleteSrc1.registry[a1.id].sourceIds).toEqual(['src-2'])
  })

  it('B05/T09 前端探测: 拒绝 HTML 200、非 JSON、错误 mode/apiVersion 与超时响应', async () => {
    expect(looksLikeHtmlDocument('<!doctype html><html></html>')).toBe(true)
    expect(looksLikeHtmlDocument('proxies:\n  - name: ok')).toBe(false)

    const htmlSpaResponse = new Response('<!doctype html><html><body>SPA</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    const spaCaps = await probeSameOriginCapabilities({
      fetchImpl: vi.fn(async () => htmlSpaResponse) as unknown as typeof fetch,
    })
    expect(spaCaps.status).toBe('unavailable')
    expect(spaCaps.fetchSubscription).toBe(false)
    expect(spaCaps.temporaryClashConfig).toBe(false)

    const wrongIdentity = new Response(
      JSON.stringify({ ok: true, mode: 'other-service', apiVersion: 2, capabilities: { temporaryClashConfig: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const wrongCaps = await probeSameOriginCapabilities({
      fetchImpl: vi.fn(async () => wrongIdentity) as unknown as typeof fetch,
    })
    expect(wrongCaps.status).toBe('unavailable')

    const validIdentity = new Response(
      JSON.stringify({
        ok: true,
        mode: 'worker-app',
        apiVersion: 1,
        capabilities: { fetchSubscription: true, temporaryClashConfig: true },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const okCaps = await probeSameOriginCapabilities({
      fetchImpl: vi.fn(async () => validIdentity) as unknown as typeof fetch,
    })
    expect(okCaps).toEqual({
      status: 'available',
      fetchSubscription: true,
      temporaryClashConfig: true,
      mode: 'worker-app',
      apiVersion: 1,
    })

    // 托管订阅接口若误返回 HTML 200 必须被拒绝
    await expect(
      loadSubscriptionContent('https://sub.example.com/list', {
        endpoint: '/api/fetch-subscription',
        sameOriginFetchAvailable: true,
        token: '',
        mode: 'hosted',
        fetchImpl: vi.fn(async () =>
          new Response('<!doctype html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTML/)
  })
})

describe('R03: VLESS WebSocket 参数对普通节点链接的完整性保护', () => {
  const fullReviewYaml = [
    'proxies:',
    '  - name: ws',
    '    type: vless',
    '    server: ws.example.invalid',
    '    port: 443',
    '    uuid: 00000000-0000-0000-0000-000000000000',
    '    tls: true',
    '    network: ws',
    '    ws-opts:',
    '      path: /socket',
    '      headers:',
    '        Host: ws.example.invalid',
    '        Authorization: Bearer-REDACTED',
    '      max-early-data: 2048',
    '      early-data-header-name: Sec-WebSocket-Protocol',
  ].join('\n')

  it('R03-T01: 仅含 path + Host 的 VLESS WS 节点正常导出普通链接且往返关键字段一致', () => {
    const parsed = parseYamlProxiesDetailed([
      'proxies:',
      '  - name: ws-std',
      '    type: vless',
      '    server: ws.example.invalid',
      '    port: 443',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      '    tls: true',
      '    network: ws',
      '    ws-opts:',
      '      path: /chat',
      '      headers:',
      '        Host: cdn.example.invalid',
    ].join('\n'))
    expect(parsed.nodes).toHaveLength(1)
    const node = parsed.nodes[0]

    expect(validateNodeForFormat(node, 'import-links').filter((d) => d.severity === 'error')).toEqual([])
    const link = toImportLink(node)
    const roundtrip = parseProxyInputDetailed(link)
    expect(roundtrip.validCount).toBe(1)
    const back = roundtrip.nodes[0]
    expect(back.type).toBe('vless')
    if (back.type === 'vless') {
      expect(back.packetType).toBe('ws')
      expect(back.wsOpts?.path).toBe('/chat')
      expect(back.wsOpts?.headers?.Host ?? back.wsOpts?.headers?.host).toBe('cdn.example.invalid')
    }
  })

  it('R03-T02: 含额外 Authorization 等自定义 WS 请求头时，import-links 明确阻止导出并指出字段，不静默丢失', () => {
    const parsed = parseYamlProxiesDetailed([
      'proxies:',
      '  - name: ws-auth',
      '    type: vless',
      '    server: ws.example.invalid',
      '    port: 443',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      '    tls: true',
      '    network: ws',
      '    ws-opts:',
      '      path: /socket',
      '      headers:',
      '        Host: ws.example.invalid',
      '        Authorization: Bearer-REDACTED',
    ].join('\n'))
    const node = parsed.nodes[0]

    const diags = validateNodeForFormat(node, 'import-links')
    const errors = diags.filter((d) => d.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((d) => /headers|Authorization/i.test(`${d.field ?? ''} ${d.message}`))).toBe(true)
    expect(() => toImportLink(node)).toThrow(/Authorization|headers/i)
  })

  it('R03-T03: 含非默认 early-data 或 v2ray-http-upgrade 时，import-links 明确阻止导出并指出无法表达的字段', () => {
    const parsedEarly = parseYamlProxiesDetailed([
      'proxies:',
      '  - name: ws-ed',
      '    type: vless',
      '    server: ws.example.invalid',
      '    port: 443',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      '    tls: true',
      '    network: ws',
      '    ws-opts:',
      '      path: /socket',
      '      max-early-data: 2048',
      '      early-data-header-name: Sec-WebSocket-Protocol',
    ].join('\n'))
    const edNode = parsedEarly.nodes[0]
    const edErrors = validateNodeForFormat(edNode, 'import-links').filter((d) => d.severity === 'error')
    expect(edErrors.length).toBeGreaterThan(0)
    expect(edErrors.some((d) => /early-data/i.test(`${d.field ?? ''} ${d.message}`))).toBe(true)
    expect(() => toImportLink(edNode)).toThrow(/early-data/i)

    const parsedUpgrade = parseYamlProxiesDetailed([
      'proxies:',
      '  - name: ws-httpup',
      '    type: vless',
      '    server: ws.example.invalid',
      '    port: 443',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      '    tls: true',
      '    network: ws',
      '    ws-opts:',
      '      path: /socket',
      '      v2ray-http-upgrade: true',
    ].join('\n'))
    const upNode = parsedUpgrade.nodes[0]
    const upErrors = validateNodeForFormat(upNode, 'import-links').filter((d) => d.severity === 'error')
    expect(upErrors.length).toBeGreaterThan(0)
    expect(upErrors.some((d) => /v2ray-http-upgrade/i.test(`${d.field ?? ''} ${d.message}`))).toBe(true)
  })

  it('R03-T04: Host 大小写变体保持一致，且方案导出与节点库独立导出均受统一保护', () => {
    const upperParsed = parseYamlProxiesDetailed([
      'proxies:',
      '  - name: ws-upper-host',
      '    type: vless',
      '    server: ws.example.invalid',
      '    port: 443',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      '    tls: true',
      '    network: ws',
      '    ws-opts:',
      '      path: /edge',
      '      headers:',
      '        HOST: upper.example.invalid',
    ].join('\n'))
    const upperNode = upperParsed.nodes[0]
    expect(validateNodeForFormat(upperNode, 'import-links').filter((d) => d.severity === 'error')).toEqual([])
    const upperLink = toImportLink(upperNode)
    expect(upperLink).toContain('host=upper.example.invalid')

    const fullParsed = parseYamlProxiesDetailed(fullReviewYaml)
    const fullNode = fullParsed.nodes[0]
    const merged = upsertSourceNodes(
      {},
      [],
      { id: 'src-ws', name: 'WS Source', kind: 'paste', nodeIds: [], status: 'success' },
      [fullNode],
    )
    const plan = createDefaultChainPlan('p-ws', 'WS方案')
    plan.entry.candidateNodeIds = [fullNode.id]
    plan.exit.enabled = false

    const planLinks = validateAndExportPlan(plan, merged.registry, [plan], 'import-links')
    expect(planLinks.valid).toBe(false)
    expect(planLinks.output).toBe('')
    expect(planLinks.diagnostics.some((d) => d.severity === 'error')).toBe(true)

    const regLinks = exportSelectedNodesAsLinks([fullNode.id], merged.registry)
    expect(regLinks.valid).toBe(false)
    expect(regLinks.output).toBe('')
    expect(regLinks.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('R03-T05: 完整复现输入对 Mihomo YAML 与配置片段仍可正常导出且保留原始 WS 参数', () => {
    const fullParsed = parseYamlProxiesDetailed(fullReviewYaml)
    const fullNode = fullParsed.nodes[0]
    const merged = upsertSourceNodes(
      {},
      [],
      { id: 'src-ws', name: 'WS Source', kind: 'paste', nodeIds: [], status: 'success' },
      [fullNode],
    )
    const plan = createDefaultChainPlan('p-ws-ok', 'WS方案')
    plan.entry.candidateNodeIds = [fullNode.id]
    plan.exit.enabled = false

    const mihomo = validateAndExportPlan(plan, merged.registry, [plan], 'clash-mihomo')
    const snippet = validateAndExportPlan(plan, merged.registry, [plan], 'clash-snippet')
    expect(mihomo.valid).toBe(true)
    expect(snippet.valid).toBe(true)

    const parsedMihomo = parseYaml(mihomo.output) as {
      proxies: Array<{ 'ws-opts'?: Record<string, unknown> }>
    }
    const wsOpts = parsedMihomo.proxies[0]['ws-opts'] as {
      path?: string
      headers?: Record<string, string>
      'max-early-data'?: number
      'early-data-header-name'?: string
    }
    expect(wsOpts.path).toBe('/socket')
    expect(wsOpts.headers?.Host).toBe('ws.example.invalid')
    expect(wsOpts.headers?.Authorization).toBe('Bearer-REDACTED')
    expect(wsOpts['max-early-data']).toBe(2048)
    expect(wsOpts['early-data-header-name']).toBe('Sec-WebSocket-Protocol')
  })
})
