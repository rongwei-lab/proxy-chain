import { describe, expect, it } from 'vitest'
import {
  generateClashYaml,
  generateClashYamlForSelections,
  generateImportLinks,
  generateXrayJson,
  generateXrayJsonForSelections,
  parseHysteria2Link,
  parseProxyInput,
  parseShadowsocksLink,
  parseSocks5Link,
  parseVlessLink,
  parseYamlProxies,
} from '../lib'

const vlessLink =
  'vless://11111111-1111-4111-8111-111111111111@example.com:443?flow=xtls-rprx-vision&sni=www.example.com&fp=chrome&pbk=public-key&type=tcp&headerType=none#VLESS%20Reality'

describe('proxy-chain parsing', () => {
  it('解析 VLESS Reality 链接', () => {
    const node = parseVlessLink(vlessLink)

    expect(node).toMatchObject({
      type: 'vless',
      uuid: '11111111-1111-4111-8111-111111111111',
      server: 'example.com',
      port: 443,
      flow: 'xtls-rprx-vision',
      sni: 'www.example.com',
      fp: 'chrome',
      pbk: 'public-key',
      packetType: 'tcp',
      headerType: 'none',
      name: 'VLESS Reality',
    })
  })

  it('解析 SOCKS5 链接', () => {
    const node = parseSocks5Link('socks5://user:pass@socks.example.com:1080#Local%20SOCKS')

    expect(node).toMatchObject({
      type: 'socks5',
      username: 'user',
      password: 'pass',
      server: 'socks.example.com',
      port: 1080,
      name: 'Local SOCKS',
    })
  })

  it('解析 Hysteria2 链接', () => {
    const node = parseHysteria2Link('hysteria2://hy2-pass@hy2.example.com:8443?sni=edge.example.com&insecure=1&udp=false#HY2%20Link')

    expect(node).toMatchObject({
      type: 'hysteria2',
      password: 'hy2-pass',
      server: 'hy2.example.com',
      port: 8443,
      sni: 'edge.example.com',
      skipCertVerify: true,
      udp: false,
      name: 'HY2 Link',
    })
  })

  it('解析 Shadowsocks/SS 链接', () => {
    const node = parseShadowsocksLink('ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpzcy1wYXNz@ss.example.com:8388?plugin=obfs#SS%20Link')

    expect(node).toMatchObject({
      type: 'ss',
      cipher: 'chacha20-ietf-poly1305',
      password: 'ss-pass',
      server: 'ss.example.com',
      port: 8388,
      plugin: 'obfs',
      name: 'SS Link',
    })
  })

  it('解析 Mihomo/Clash YAML proxies 数组', () => {
    const nodes = parseYamlProxies(`
proxies:
  - name: "YAML VLESS"
    type: vless
    server: yaml.example.com
    port: 443
    uuid: 22222222-2222-4222-8222-222222222222
    flow: xtls-rprx-vision
    servername: edge.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: yaml-public-key
    udp: true
  - name: "YAML SOCKS"
    type: socks5
    server: socks.yaml.example.com
    port: 1080
    username: yaml-user
    password: yaml-pass
    udp: true
`)

    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      type: 'vless',
      name: 'YAML VLESS',
      server: 'yaml.example.com',
      port: 443,
      pbk: 'yaml-public-key',
      sni: 'edge.example.com',
    })
    expect(nodes[1]).toMatchObject({
      type: 'socks5',
      username: 'yaml-user',
      password: 'yaml-pass',
      udp: true,
    })
  })

  it('解析 Shadowsocks/SS YAML 节点并保留插件字段', () => {
    const nodes = parseYamlProxies(`
proxies:
  - name: "YAML SS"
    type: ss
    server: ss.yaml.example.com
    port: 8388
    udp: true
    udp-over-tcp: true
    cipher: chacha20-ietf-poly1305
    password: ss-yaml-pass
    plugin: obfs
    plugin-opts:
      mode: tls
      host: example.com
`)

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: 'ss',
      name: 'YAML SS',
      cipher: 'chacha20-ietf-poly1305',
      password: 'ss-yaml-pass',
      plugin: 'obfs',
      pluginOpts: {
        mode: 'tls',
        host: 'example.com',
      },
      udp: true,
      udpOverTcp: true,
    })
  })

  it('解析 GLaDOS 风格的 Mihomo Shadowsocks/SS 订阅结构', () => {
    const result = parseProxyInput(`
proxies:
  - name: "US-Balancer-N1-1"
    type: ss
    server: ss-1.example.com
    port: 2377
    udp: true
    udp-over-tcp: true
    cipher: chacha20-ietf-poly1305
    password: ss-pass-1
    plugin: obfs
    plugin-opts:
      mode: tls
      host: edge.example.com
  - name: "US-Balancer-N1-2"
    type: ss
    server: ss-2.example.com
    port: 2378
    udp: true
    udp-over-tcp: true
    cipher: chacha20-ietf-poly1305
    password: ss-pass-2
    plugin: obfs
    plugin-opts:
      mode: tls
      host: edge.example.com
`)

    expect(result.nodes).toHaveLength(2)
    expect(new Set(result.nodes.map((node) => node.type))).toEqual(new Set(['ss']))
    expect(result.warnings).toHaveLength(0)
  })

  it('解析单个 hysteria2 YAML 片段', () => {
    const result = parseProxyInput(`
name: HY2
type: hysteria2
server: hy2.example.com
port: 8443
password: hy2-password
sni: hy2-sni.example.com
skip-cert-verify: true
udp: true
`)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]).toMatchObject({
      type: 'hysteria2',
      password: 'hy2-password',
      sni: 'hy2-sni.example.com',
      skipCertVerify: true,
    })
  })
})

describe('proxy-chain generation', () => {
  it('Clash/Mihomo 输出使用 dialer-proxy 且不生成 relay', () => {
    const entry = parseVlessLink(vlessLink)
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#Exit')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const yaml = generateClashYaml(entry!, exit!)

    expect(yaml).toContain('name: 入口节点')
    expect(yaml).toContain('name: PROXY')
    expect(yaml).toContain('dialer-proxy: 入口节点')
    expect(yaml).not.toContain('relay')
  })

  it('Clash/Mihomo 输出支持 Shadowsocks/SS 节点字段', () => {
    const entry = parseShadowsocksLink('ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTplbnRyeS1wYXNz@entry-ss.example.com:8388#Entry%20SS')
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#Exit')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const yaml = generateClashYaml(entry!, exit!)

    expect(yaml).toContain('type: ss')
    expect(yaml).toContain('cipher: chacha20-ietf-poly1305')
    expect(yaml).toContain('password: entry-pass')
    expect(yaml).toContain('dialer-proxy: 入口节点')
  })

  it('v2rayN/Xray JSON 输出包含 proxySettings', () => {
    const entry = parseVlessLink(vlessLink)
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#Exit')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const config = JSON.parse(generateXrayJson(entry!, exit!)) as {
      outbounds: Array<{ tag: string; proxySettings?: { tag: string } }>
    }

    expect(config.outbounds[0].proxySettings?.tag).toBe('VLESS-Reality-entry')
  })

  it('入口和出口都支持不同节点类型组合', () => {
    const entry = parseSocks5Link('socks5://user:pass@entry.example.com:1080#Entry%20SOCKS')
    const exit = parseVlessLink(vlessLink)
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const yaml = generateClashYaml(entry!, exit!)
    const config = JSON.parse(generateXrayJson(entry!, exit!)) as {
      outbounds: Array<{ protocol: string; proxySettings?: { tag: string } }>
    }

    expect(yaml).toContain('name: "Entry SOCKS-入口"')
    expect(yaml).toContain('dialer-proxy: 入口节点')
    expect(config.outbounds[0].protocol).toBe('vless')
    expect(config.outbounds[0].proxySettings?.tag).toBe('Entry-SOCKS-entry')
  })

  it('Clash/Mihomo 导出时自动避让入口和出口同名节点', () => {
    const entry = parseVlessLink(
      'vless://11111111-1111-4111-8111-111111111111@entry.example.com:443?flow=xtls-rprx-vision&sni=edge.example.com&fp=chrome&pbk=entry-key&type=tcp&headerType=none#香港',
    )
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#香港')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const yaml = generateClashYaml(entry!, exit!)
    const names = Array.from(yaml.matchAll(/^\s*-?\s*name: "?([^"\n]+)"?/gm)).map((match) => match[1])

    expect(yaml).toContain('name: 香港-入口')
    expect(yaml).toContain('name: 香港-出口')
    expect(yaml).toContain('dialer-proxy: 入口节点')
    expect(new Set(names).size).toBe(names.length)
  })

  it('Clash/Mihomo 多选导出时入口组和出口组包含所有选中节点', () => {
    const entries = [
      parseSocks5Link('socks5://user:pass@entry-1.example.com:1080#Entry'),
      parseSocks5Link('socks5://user:pass@entry-2.example.com:1081#Entry'),
    ]
    const exits = [
      parseSocks5Link('socks5://user:pass@exit-1.example.com:1080#Exit'),
      parseShadowsocksLink('ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpleGl0LXBhc3M@exit-2.example.com:8388#Exit'),
    ]
    expect(entries.every(Boolean)).toBe(true)
    expect(exits.every(Boolean)).toBe(true)

    const yaml = generateClashYamlForSelections(
      entries.filter((node): node is NonNullable<typeof node> => Boolean(node)),
      exits.filter((node): node is NonNullable<typeof node> => Boolean(node)),
    )

    expect(yaml).toContain('name: Entry-入口')
    expect(yaml).toContain('name: Entry-入口-2')
    expect(yaml).toContain('name: Exit-出口')
    expect(yaml).toContain('name: Exit-出口-2')
    expect(yaml.match(/dialer-proxy: 入口节点/g)).toHaveLength(2)
    expect(yaml).toContain('proxies:\n      - Entry-入口\n      - Entry-入口-2')
    expect(yaml).toContain('proxies:\n      - Exit-出口\n      - Exit-出口-2')
  })

  it('v2rayN/Xray 多选导出时多个出口都链到第一个入口', () => {
    const entries = [
      parseVlessLink(vlessLink),
      parseSocks5Link('socks5://user:pass@entry-2.example.com:1081#Entry 2'),
    ]
    const exits = [
      parseSocks5Link('socks5://user:pass@exit-1.example.com:1080#Exit 1'),
      parseSocks5Link('socks5://user:pass@exit-2.example.com:1081#Exit 2'),
    ]
    expect(entries.every(Boolean)).toBe(true)
    expect(exits.every(Boolean)).toBe(true)

    const config = JSON.parse(
      generateXrayJsonForSelections(
        entries.filter((node): node is NonNullable<typeof node> => Boolean(node)),
        exits.filter((node): node is NonNullable<typeof node> => Boolean(node)),
      ),
    ) as {
      outbounds: Array<{ tag: string; proxySettings?: { tag: string } }>
    }

    expect(config.outbounds).toHaveLength(4)
    expect(config.outbounds[0].proxySettings?.tag).toBe('VLESS-Reality-entry')
    expect(config.outbounds[1].proxySettings?.tag).toBe('VLESS-Reality-entry')
    expect(config.outbounds.map((outbound) => outbound.tag)).toEqual([
      'Exit-1-exit',
      'Exit-2-exit',
      'VLESS-Reality-entry',
      'Entry-2-entry',
    ])
  })

  it('生成 import links 文本', () => {
    const entry = parseVlessLink(vlessLink)
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#Exit')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const links = generateImportLinks([entry!, exit!])

    expect(links).toContain('vless://')
    expect(links).toContain('socks5://user:pass@exit.example.com:1080#Exit')
  })
})
