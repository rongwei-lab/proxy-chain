import { describe, expect, it } from 'vitest'
import {
  generateClashYaml,
  generateImportLinks,
  generateXrayJson,
  parseProxyInput,
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

  it('v2rayN/Xray JSON 输出包含 proxySettings', () => {
    const entry = parseVlessLink(vlessLink)
    const exit = parseSocks5Link('socks5://user:pass@exit.example.com:1080#Exit')
    expect(entry).toBeDefined()
    expect(exit).toBeDefined()

    const config = JSON.parse(generateXrayJson(entry!, exit!)) as {
      outbounds: Array<{ tag: string; proxySettings?: { tag: string } }>
    }

    expect(config.outbounds[0].proxySettings?.tag).toBe('VLESS-Reality')
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
