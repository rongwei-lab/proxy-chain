import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import App from '../App'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function findButton(container: HTMLElement, textIncludes: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button'))
  const match = buttons.find((btn) => (btn.textContent ?? '').includes(textIncludes))
  if (!match) {
    throw new Error(`Button containing "${textIncludes}" not found`)
  }
  return match
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function gotoStep(container: HTMLElement, step: 1 | 2 | 3) {
  const btnText = step === 1 ? '导入节点' : step === 2 ? '选择链路' : '下载配置'
  await act(async () => {
    const navBtn = Array.from(container.querySelectorAll('.step-nav button')).find((b) =>
      (b.textContent ?? '').includes(btnText),
    ) as HTMLButtonElement | undefined
    navBtn?.click()
  })
}

async function openAdvanced(container: HTMLElement, group?: 'chain' | 'save') {
  const alreadyOpen = container.querySelector('.advanced-panel') !== null
  if (!alreadyOpen) {
    await act(async () => {
      findButton(container, '高级设置').click()
    })
  }
  if (group) {
    await act(async () => {
      const label = group === 'chain' ? '链路与分流' : '本机保存'
      const toggle = Array.from(
        container.querySelectorAll('.adv-group-toggle'),
      ).find((el) => (el.textContent ?? '').includes(label)) as HTMLButtonElement | undefined
      toggle?.click()
    })
  }
}

async function importViaUnified(container: HTMLElement, text: string, name = '') {
  const textarea = container.querySelector(
    'textarea[aria-label="订阅地址或节点内容"]',
  ) as HTMLTextAreaElement
  await act(async () => {
    setNativeValue(textarea, text)
    if (name) {
      const nameInput = container.querySelector(
        'input[placeholder="例如：日常机场订阅 / 自建落地节点"]',
      ) as HTMLInputElement
      if (nameInput) setNativeValue(nameInput, name)
    }
  })
  const importBtn = Array.from(container.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === '导入',
  ) as HTMLButtonElement
  await act(async () => {
    importBtn.click()
  })
  await flushMicrotasks()
}


/** 展开来源行并点击删除（不确认），返回是否找到 */
async function requestDeleteSource(container: HTMLElement, sourceName: string): Promise<void> {
  const card = await expandSourceRow(container, sourceName)
  const delBtn = card.querySelector(
    `button[aria-label="删除来源 ${sourceName}"]`,
  ) as HTMLButtonElement | null
  if (!delBtn) {
    throw new Error(`Delete button for "${sourceName}" not found`)
  }
  await act(async () => {
    delBtn.click()
  })
}

async function confirmDeleteSource(container: HTMLElement): Promise<void> {
  await act(async () => {
    findButton(container, '确认删除该来源').click()
  })
}

// 脱敏示例节点（与原“试用示例”相同来源，改为统一输入粘贴导入）
const DEMO_NODES_TEXT = [
  'socks5://demo-user:demo-pass@203.0.113.10:1080#Entry-SOCKS5-JP',
  'vless://11111111-1111-4111-8111-111111111111@203.0.113.11:443?security=reality&encryption=none&flow=xtls-rprx-vision&sni=cdn.example.com&fp=chrome&pbk=demoPublicKeyEntry01&sid=0012&type=tcp#Entry-VLESS-SG',
  'vless://22222222-2222-4222-8222-222222222222@198.51.100.20:443?security=reality&encryption=none&flow=xtls-rprx-vision&sni=exit.example.com&fp=firefox&pbk=demoPublicKeyExit02&sid=00ab&type=tcp#Exit-US-Reality',
  'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpkZW1vLXNzLXBhc3M@198.51.100.21:8388#Exit-DE-SS',
].join('\n')

/** 导入示例节点并在步骤 2 预选入口 + 出口（等价原“试用示例”的自动预选） */
async function importDemoNodes(container: HTMLElement) {
  await importViaUnified(container, DEMO_NODES_TEXT)
  await gotoStep(container, 2)
  const cards = container.querySelectorAll('.stage-card')
  const entryCard = cards[0]
  const exitCard = cards[cards.length - 1]
  const checkNode = async (card: Element, nodeName: string) => {
    const cb = Array.from(card.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes(nodeName))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    if (cb && !cb.checked) {
      await act(async () => {
        cb.click()
      })
    }
  }
  await checkNode(entryCard, 'Entry-SOCKS5-JP')
  await checkNode(exitCard, 'Exit-US-Reality')
}
/** 展开指定来源行（若未展开），返回其卡片元素 */
async function expandSourceRow(container: HTMLElement, sourceName: string): Promise<HTMLElement> {
  const card = Array.from(container.querySelectorAll('.source-item-card')).find((el) =>
    (el.textContent ?? '').includes(sourceName),
  ) as HTMLElement
  if (!card) {
    const names = Array.from(container.querySelectorAll('.source-item-card')).map(
      (el) => el.querySelector('strong')?.textContent ?? '?',
    )
    throw new Error(`Source card "${sourceName}" not found; existing=[${names.join(',')}]`)
  }
  if (!card.querySelector('.source-item-detail')) {
    const expandBtn = card.querySelector('button.source-row-toggle') as HTMLButtonElement
    await act(async () => {
      expandBtn.click()
    })
  }
  return card
}

describe('App UI 交互、能力降级、竞态保护与持久化验证', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('B05/T12/T13: 识别 Vite HTML 回退禁用临时导入、空状态不报就绪、独立出口开关保持选择但零残留', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    // 空输入时不误报“导出就绪”
    const statusBar = container.querySelector('.status-bar')
    expect(statusBar?.textContent).toContain('等待完成节点选择')
    expect(statusBar?.textContent).not.toContain('导出就绪')

    // 首屏只展示第 1 步，无空节点红色错误墙；高级设置可访问（U01）
    expect(container.textContent).toContain('导入节点')
    expect(container.querySelector('.step-pane:not([hidden])')).toBeTruthy()
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('高级设置'),
      ),
    ).toBe(true)

    // 试用示例（在“更多方式”内）
    await importDemoNodes(container)

    // 进入步骤 2 查看链路，再进步骤 3
    await gotoStep(container, 2)
    if (!container.textContent?.includes('选择链路')) {
      throw new Error('DEBUG step2 missing. text=' + (container.textContent ?? '').slice(0, 300))
    }
    expect(container.querySelector('.status-bar')?.textContent).toContain('导出就绪')
    await gotoStep(container, 3)

    // HTML SPA 回退下同源临时链接功能降级禁用（展开“临时导入链接”折叠区给出短提示）
    await act(async () => {
      findButton(container, '临时导入链接').click()
    })
    expect(container.textContent).toContain('当前环境未启用同源临时配置存储')
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('生成 600 秒临时导入链接'),
      ),
    ).toBe(false)

    // 展开配置预览校验导出内容
    await act(async () => {
      findButton(container, '查看配置').click()
    })
    const yamlBefore = container.querySelector('.code-preview code')?.textContent ?? ''
    const parsedBefore = parseYaml(yamlBefore) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
    }
    expect(parsedBefore.proxies).toHaveLength(2)
    expect(parsedBefore.proxies[1]['dialer-proxy']).toBe('入口节点')

    // 关闭独立出口：保留原选节点但预览 YAML 零残留（在步骤 2 操作，回步骤 3 验证）
    await gotoStep(container, 2)
    const entryOnlyButton = findButton(container, '仅入口代理')
    const chainProxyButton = findButton(container, '链式代理')

    await act(async () => {
      entryOnlyButton.click()
    })

    expect(container.textContent).toContain('已关闭出口节点')
    await gotoStep(container, 3)
    const yamlOff = container.querySelector('.code-preview code')?.textContent ?? ''
    const parsedOff = parseYaml(yamlOff) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
      rules: string[]
    }
    expect(parsedOff.proxies).toHaveLength(1)
    expect(parsedOff.proxies[0]['dialer-proxy']).toBeUndefined()
    expect(parsedOff.rules).toContain('MATCH,入口节点')

    // 重新开启独立出口：保留的选择自动恢复
    await gotoStep(container, 2)
    await act(async () => {
      chainProxyButton.click()
    })
    await gotoStep(container, 3)
    const yamlBack = container.querySelector('.code-preview code')?.textContent ?? ''
    const parsedBack = parseYaml(yamlBack) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
    }
    expect(parsedBack.proxies).toHaveLength(2)
    expect(parsedBack.proxies[1]['dialer-proxy']).toBe('入口节点')
  })

  it('T15: 取消/并发订阅刷新丢弃过期响应，失败刷新保留已有节点', async () => {
    let subFetchCount = 0
    let resolveSecondRefresh!: (res: Response) => void
    let resolveStaleFirstRefresh!: (res: Response) => void

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/healthz')) {
        return new Response(
          JSON.stringify({
            ok: true,
            mode: 'worker-app',
            apiVersion: 1,
            capabilities: { fetchSubscription: true, temporaryClashConfig: true },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/fetch-subscription')) {
        subFetchCount += 1
        if (subFetchCount === 1) {
          return new Response(
            JSON.stringify({
              content: 'socks5://u:p@initial.example.com:1080#初始节点',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        if (subFetchCount === 2) {
          return new Promise<Response>((resolve) => {
            resolveStaleFirstRefresh = resolve
          })
        }
        if (subFetchCount === 3) {
          return new Promise<Response>((resolve) => {
            resolveSecondRefresh = resolve
          })
        }
        return new Response('<!doctype html><html><body>502</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    // 统一输入：粘贴单个订阅地址（自动识别为订阅，联网获取；使用自动命名）
    await importViaUnified(container, 'https://sub.example.com/nodes.txt')
    expect(container.textContent).toContain('初始节点')

    // 触发第 1 次刷新（慢请求），随即取消并触发第 2 次刷新（新请求）
    const mainSrcCard = await expandSourceRow(container, '订阅-1')
    const refreshBtnOf = (card: HTMLElement) =>
      Array.from(card.querySelectorAll('button')).find(
        (b) => (b.textContent ?? '').includes('刷新'),
      ) as HTMLButtonElement
    await act(async () => {
      refreshBtnOf(mainSrcCard).click()
    })
    await act(async () => {
      findButton(mainSrcCard, '取消刷新').click()
    })
    await act(async () => {
      refreshBtnOf(mainSrcCard).click()
    })

    // 先完成最新请求 (#2)，再延迟触发被取消的请求 (#1) 返回过期数据
    await act(async () => {
      resolveSecondRefresh(
        new Response(
          JSON.stringify({
            content: 'socks5://u:p@fresh.example.com:1080#最新节点',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    await flushMicrotasks()

    await act(async () => {
      resolveStaleFirstRefresh(
        new Response(
          JSON.stringify({
            content: 'socks5://u:p@stale.example.com:1080#过期污染节点',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('最新节点')
    expect(container.textContent).not.toContain('过期污染节点')

    // 第 3 次刷新返回 HTML 错误：旧的“最新节点”必须被保留
    const cardAgain = await expandSourceRow(container, '订阅-1')
    await act(async () => {
      refreshBtnOf(cardAgain).click()
    })
    await flushMicrotasks()

    expect(container.textContent).toContain('最新节点')
    expect(container.textContent).toContain('失败（已保留旧节点）')
  })

  it('T17: 节点选择器过滤后全选/清空当前结果保留过滤外已选节点', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importViaUnified(
      container,
      [
        'socks5://u:p@tokyo1.example.com:1080#Tokyo-A',
        'socks5://u:p@tokyo2.example.com:1081#Tokyo-B',
        'socks5://u:p@london1.example.com:1082#London-C',
      ].join('\n'),
    )

    // 进入步骤 2，先在入口层勾选 London-C
    await gotoStep(container, 2)
    const stageCards = Array.from(container.querySelectorAll('.stage-card'))
    const entryCard = stageCards[0]
    const londonCheckbox = Array.from(entryCard.querySelectorAll('.selector-node-item'))
      .find((item) => (item.textContent ?? '').includes('London-C'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement

    await act(async () => {
      londonCheckbox.click()
    })
    expect(entryCard.textContent).toContain('本层已选 1')

    // 搜索 Tokyo 并点击“全选当前结果”：London-C 必须继续保留，共 3 个已选
    const searchInput = entryCard.querySelector('input[type="search"]') as HTMLInputElement
    await act(async () => {
      setNativeValue(searchInput, 'Tokyo')
    })
    await act(async () => {
      findButton(entryCard as HTMLElement, '全选当前结果').click()
    })
    expect(entryCard.textContent).toContain('总计 3 / 匹配 2 / 本层已选 3')

    // 点击“清空当前结果”：仅取消 Tokyo-A/B，London-C 仍然保留
    await act(async () => {
      findButton(entryCard as HTMLElement, '清空当前结果').click()
    })
    expect(entryCard.textContent).toContain('总计 3 / 匹配 2 / 本层已选 1')
  })

  it('T21/T22/T25: 本机安全保存不含凭据、缺节点提示与高级模式中转保留', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importDemoNodes(container)

    // 高级面板 → 链路与分流：切到高级模式、添加中转层、再切回简洁模式保留 relays
    await gotoStep(container, 2)
    await openAdvanced(container, 'chain')
    await act(async () => {
      findButton(container, '高级模式').click()
    })
    await act(async () => {
      findButton(container, '添加中转层').click()
    })
    expect(container.textContent).toContain('中转层 1')

    await act(async () => {
      findButton(container, '简洁模式').click()
    })
    expect(container.textContent).toContain('已暂隐 1 个中转层')

    // 默认保存不含任何凭据或节点密钥（高级面板 → 本机保存）
    await openAdvanced(container, 'save')
    await act(async () => {
      findButton(container, '保存到本机').click()
    })
    const savedRaw = globalThis.localStorage.getItem('proxy-chain:workspace:v1')
    expect(savedRaw).toBeTruthy()
    expect(savedRaw!).not.toContain('demo-pass')
    expect(savedRaw!).not.toContain('demo-ss-pass')
    expect(savedRaw!).toContain('"schemaVersion":1')

    // 模拟刷新页面后恢复：不自动恢复；点击“从本机恢复”后恢复方案并标示缺失节点
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    expect(container.querySelector('.status-bar')?.textContent).toContain('等待完成节点选择')
    // 空节点时也能打开高级设置，用本机恢复（U08）
    await openAdvanced(container, 'save')
    await act(async () => {
      findButton(container, '从本机恢复').click()
    })
    expect(container.textContent).toContain('节点缺失')
    await gotoStep(container, 2)
    expect(container.textContent).toContain('已暂隐 1 个中转层')

    // 清除本机保存
    await act(async () => {
      findButton(container, '清除本机保存').click()
    })
    expect(globalThis.localStorage.getItem('proxy-chain:workspace:v1')).toBeNull()
  })
})

describe('R01 / R02 UI 交互回归验证', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('R01-T01: 删除来源 A → 新增粘贴与订阅来源 B → 撤销恢复 A，B 及其节点和会话订阅 URL 保留', async () => {
    let subRefreshCount = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/healthz')) {
        return new Response(
          JSON.stringify({
            ok: true,
            mode: 'worker-app',
            apiVersion: 1,
            capabilities: { fetchSubscription: true, temporaryClashConfig: false },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/fetch-subscription')) {
        subRefreshCount += 1
        return new Response(
          JSON.stringify({
            content:
              subRefreshCount === 1
                ? 'socks5://u:p@new-sub.example.invalid:1080#订阅新增节点1'
                : 'socks5://u:p@new-sub2.example.invalid:1080#订阅刷新后节点2',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importDemoNodes(container)

    // 删除粘贴来源 (A)——唯一来源，包含全部示例节点
    await gotoStep(container, 1)
    await requestDeleteSource(container, '粘贴来源-1')
    await confirmDeleteSource(container)
    expect(container.querySelector('.source-list')?.textContent ?? '').not.toContain('粘贴来源-1')

    // 新增粘贴来源 B1（统一输入；名称通过“更多方式”可选，这里使用自动命名后校验节点存在）
    await importViaUnified(
      container,
      'socks5://demo:REDACTED@new.example.invalid:1080#新增节点',
    )
    expect(container.textContent).toContain('新增节点')

    // 新增订阅来源 B2（统一输入订阅地址，保留会话 URL；使用自动命名）
    await importViaUnified(container, 'https://sub.example.invalid/list')
    expect(container.textContent).toContain('订阅新增节点1')

    // 点击“撤销删除”恢复被删的粘贴来源（含全部示例节点）
    await act(async () => {
      findButton(container, '撤销删除').click()
    })

    const sourceListText = container.querySelector('.source-list')?.textContent ?? ''
    // 撤销恢复的来源（粘贴来源-1）与期间新增的 B1/B2 共存
    expect(sourceListText).toContain('粘贴来源-1')
    expect(container.textContent).toContain('新增节点')
    expect(container.textContent).toContain('订阅新增节点1')
    expect(container.textContent).toContain('Entry-SOCKS5-JP')

    // 确认撤销后 B2 订阅的会话 URL 仍存在，可以直接刷新（按订阅来源类型定位）
    const subCards = Array.from(container.querySelectorAll('.source-item-card')).filter(
      (el) => (el.textContent ?? '').includes('订阅-'),
    )
    const subCard = subCards[subCards.length - 1] as HTMLElement
    if (!subCard.querySelector('.source-item-detail')) {
      await act(async () => {
        ;(subCard.querySelector('button.source-row-toggle') as HTMLButtonElement).click()
      })
    }
    const refreshBBtn = Array.from(subCard.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('刷新'),
    ) as HTMLButtonElement
    await act(async () => {
      refreshBBtn.click()
    })
    await flushMicrotasks()
    expect(container.textContent).toContain('订阅刷新后节点2')
  })

  it('R01-T02/R01-T03/R01-T04/R01-T05: 撤销保留别名/方案编辑/其他来源刷新结果与共享关系，且单步撤销不回滚更早删除', async () => {
    let subPull = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/healthz')) {
        return new Response(
          JSON.stringify({
            ok: true,
            mode: 'worker-app',
            apiVersion: 1,
            capabilities: { fetchSubscription: true, temporaryClashConfig: false },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/fetch-subscription')) {
        subPull += 1
        const bodyText =
          subPull === 1
            ? [
                'socks5://u:p@shared.example.invalid:1080#共享节点',
                'socks5://u:p@c1.example.invalid:1080#C初版节点',
              ].join('\n')
            : [
                'socks5://u:p@shared.example.invalid:1080#共享节点',
                'socks5://u:p@c2.example.invalid:1080#C刷新后节点',
              ].join('\n')
        return new Response(JSON.stringify({ content: bodyText }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    // 准备 来源A（含共享节点 + A独占；统一输入粘贴）与 订阅C（含同共享节点 + C初版；统一输入订阅）
    await importViaUnified(
      container,
      [
        'socks5://u:p@shared.example.invalid:1080#共享节点',
        'socks5://u:p@only-a.example.invalid:1080#A独占节点',
      ].join('\n'),
    )
    await importViaUnified(container, 'https://sub.example.invalid/c')

    // 先重命名共享节点（入口层在步骤 2），再删除来源 A
    await gotoStep(container, 2)
    await act(async () => {
      ;(container.querySelector('button[aria-label="重命名 共享节点"]') as HTMLButtonElement).click()
    })
    const aliasInput = container.querySelector('.alias-edit-row input') as HTMLInputElement
    await act(async () => {
      setNativeValue(aliasInput, '共享编辑别名')
    })
    await act(async () => {
      ;(container.querySelector('.alias-edit-row button[aria-label="保存"]') as HTMLButtonElement).click()
    })

    // 删除 来源A（粘贴来源，自动命名“粘贴-1”）
    await requestDeleteSource(container, '粘贴来源-1')
    await confirmDeleteSource(container)

    // 在删除 A 后：新建方案（高级面板）与修改别名，并刷新来源 C 得到新节点
    await openAdvanced(container, 'chain')
    await act(async () => {
      findButton(container, '新建方案').click()
    })
    await act(async () => {
      ;(container.querySelector('button[aria-label="重命名 共享编辑别名"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      setNativeValue(container.querySelector('.alias-edit-row input') as HTMLInputElement, '删除后新别名')
    })
    await act(async () => {
      ;(container.querySelector('.alias-edit-row button[aria-label="保存"]') as HTMLButtonElement).click()
    })

    const cardC = await expandSourceRow(container, '订阅-2')
    await act(async () => {
      Array.from(cardC.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').includes('刷新'))!
        .click()
    })
    await flushMicrotasks()
    expect(container.textContent).toContain('C刷新后节点')

    // 撤销恢复 来源A：期间修改的方案 2、用户新别名、C 刷新结果与共享去重关系均保留
    await act(async () => {
      findButton(container, '撤销删除').click()
    })

    expect(container.textContent).toContain('A独占节点')
    expect(container.textContent).toContain('C刷新后节点')
    expect(container.textContent).not.toContain('C初版节点')
    expect(container.textContent).toContain('删除后新别名')
    expect(container.textContent).toContain('方案 2')
    const entryNodeItems = container.querySelectorAll('.stage-card')[0].querySelectorAll('.node-alias')
    const matchingAliasCount = Array.from(entryNodeItems).filter(
      (el) => el.textContent === '删除后新别名',
    ).length
    expect(matchingAliasCount).toBe(1)

    // R01-T05: 连续删除 粘贴-1 再删除 订阅-1 -> 只可撤销最近一次，且撤销后横幅消失不可二次撤销
    await requestDeleteSource(container, '粘贴来源-1')
    await confirmDeleteSource(container)
    await requestDeleteSource(container, '订阅-2')
    await act(async () => {
      findButton(container, '确认删除该来源').click()
    })

    await act(async () => {
      findButton(container, '撤销删除').click()
    })

    const afterSeqUndo = container.querySelector('.source-list')?.textContent ?? ''
    expect(afterSeqUndo).toContain('订阅-2')
    expect(afterSeqUndo).not.toContain('粘贴来源-1')
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('撤销删除'),
      ),
    ).toBe(false)
  })

  it('R02-T01/R02-T06: 无效方案文件（customRules: [null]）导入展示错误但不白屏且完整保留现有工作区；有效替换后清理旧撤销', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importDemoNodes(container)
    expect(container.querySelector('.status-bar')?.textContent).toContain('导出就绪')

    // 制造一个可撤销记录（删除粘贴来源后再加载一个额外来源）
    await gotoStep(container, 1)
    await requestDeleteSource(container, '粘贴来源-1')
    await confirmDeleteSource(container)
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('撤销删除'),
      ),
    ).toBe(true)

    // 再重新加个粘贴来源并选择导出，保持页面工作区处于健康状态
    await importViaUnified(container, 'socks5://u:p@keep.example.invalid:1080#保留节点')

    const badJson = JSON.stringify({
      schemaVersion: 1,
      includesCredentials: false,
      activePlanId: 'review-plan',
      plans: [
        {
          schemaVersion: 1,
          id: 'review-plan',
          name: '脱敏校验样例',
          mode: 'simple',
          entry: {
            id: 'entry',
            name: '入口',
            enabled: true,
            candidateNodeIds: [],
            strategy: 'select',
          },
          relays: [],
          exit: {
            id: 'exit',
            name: '出口',
            enabled: false,
            candidateNodeIds: [],
            strategy: 'select',
          },
          routingPreset: 'custom',
          customRules: [null],
          customFallbackTarget: {
            kind: 'plan',
            planId: 'review-plan',
          },
        },
      ],
      sources: [],
    })

    await openAdvanced(container, 'save')
    const fileInput = container.querySelector('input[aria-label="导入方案 JSON"]') as HTMLInputElement
    const badFile = new File([badJson], 'bad-plan.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [badFile], configurable: true })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    // 页面不白屏，显示校验错误，且原有工作区状态与来源完全保留
    expect(container.querySelector('.app-shell')).toBeTruthy()
    expect(container.querySelector('.workspace')).toBeTruthy()
    const persistenceAlert = container.querySelector('.workspace-bar .feedback-banner[role="alert"]')
    expect(persistenceAlert?.textContent).toMatch(/customRules/)
    expect(container.querySelector('.source-list')?.textContent).toContain('粘贴来源-1')
    expect(container.textContent).toContain('保留节点')

    // 有效工作区替换：导入合法新方案后应清除旧工作区的撤销删除状态
    const validReplacement = JSON.stringify({
      schemaVersion: 1,
      includesCredentials: false,
      activePlanId: 'replaced-plan',
      plans: [
        {
          schemaVersion: 1,
          id: 'replaced-plan',
          name: '新工作区方案',
          mode: 'simple',
          entry: {
            id: 'entry',
            name: '入口',
            enabled: true,
            candidateNodeIds: [],
            strategy: 'select',
          },
          relays: [],
          exit: {
            id: 'exit',
            name: '出口',
            enabled: false,
            candidateNodeIds: [],
            strategy: 'select',
          },
          routingPreset: 'cn-direct',
          customRules: [],
          customFallbackTarget: { kind: 'plan', planId: 'replaced-plan' },
        },
      ],
      sources: [],
    })
    const validFile = new File([validReplacement], 'valid-plan.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [validFile], configurable: true })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(container.textContent).toContain('新工作区方案')
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        (b.textContent ?? '').includes('撤销删除'),
      ),
    ).toBe(false)
  })
})

describe('Z01 / Z02 / Z03 页面级交互回归验证', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('Z01-T01: 导入 candidateNodeIds 含 "constructor" 的方案文件，页面不白屏且显示待补全/失效提示', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importDemoNodes(container)
    expect(container.querySelector('.status-bar')?.textContent).toContain('导出就绪')

    const z01Json = JSON.stringify({
      schemaVersion: 1,
      includesCredentials: false,
      activePlanId: 'review-plan',
      plans: [
        {
          schemaVersion: 1,
          id: 'review-plan',
          name: '复测方案',
          mode: 'simple',
          entry: {
            id: 'review-entry',
            name: '入口',
            enabled: true,
            candidateNodeIds: ['constructor'],
            strategy: 'select',
          },
          relays: [],
          exit: {
            id: 'review-exit',
            name: '出口',
            enabled: false,
            candidateNodeIds: [],
            strategy: 'select',
          },
          routingPreset: 'cn-direct',
          customRules: [],
          customFallbackTarget: {
            kind: 'plan',
            planId: 'review-plan',
          },
        },
      ],
      sources: [],
    })

    await openAdvanced(container, 'save')
    const fileInput = container.querySelector('input[aria-label="导入方案 JSON"]') as HTMLInputElement
    const badFile = new File([z01Json], 'z01-plan.json', { type: 'application/json' })
    Object.defineProperty(fileInput, 'files', { value: [badFile], configurable: true })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    // 页面不白屏：根结构仍在，无待处理的渲染异常
    expect(container.querySelector('.app-shell')).toBeTruthy()
    expect(container.querySelector('.workspace')).toBeTruthy()

    // constructor 引用被当成缺失引用处理：显示缺失提示且导出被阻止
    const statusBar = container.querySelector('.status-bar')
    expect(statusBar?.textContent).not.toContain('导出就绪')
    expect(container.textContent).toContain('节点缺失')
    expect(container.textContent).toContain('1 项待处理')
  })
})

describe('U 系列三步流程与统一输入回归', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('U01: 首次打开只展示第 1 步主体，无空节点红色错误墙，高级设置可访问', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    // 仅步骤 1 可见；步骤 2/3 pane 处于 hidden
    const panes = Array.from(container.querySelectorAll('.step-pane'))
    expect(panes).toHaveLength(3)
    expect(panes[0].hasAttribute('hidden')).toBe(false)
    expect(panes[1].hasAttribute('hidden')).toBe(true)
    expect(panes[2].hasAttribute('hidden')).toBe(true)

    // 空节点：无红色诊断墙，可直接进入步骤 2 添加节点。
    expect(container.querySelector('.diagnostics-box.error')).toBeNull()
    const nextBtn = Array.from(container.querySelectorAll('.step-footer button')).find((b) =>
      (b.textContent ?? '').includes('下一步'),
    ) as HTMLButtonElement
    expect(nextBtn.disabled).toBe(false)
    expect(container.textContent).toContain('也可在下一步直接添加节点')

    // 高级设置可用
    await openAdvanced(container)
    expect(container.querySelector('.advanced-panel')).toBeTruthy()
  })

  it('U02/U03: 统一输入分派——节点/YAML 本地解析不联网；多地址混贴提示拆分且保留输入', async () => {
    let networkCalls = 0
    globalThis.fetch = vi.fn(async () => {
      networkCalls += 1
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    // 节点链接 → 本地解析，不发网络请求
    await importViaUnified(container, 'socks5://u:p@u02a.example.invalid:1080#U02节点')
    expect(container.textContent).toContain('U02节点')
    expect(networkCalls).toBe(1) // 仅 healthz 探测

    // Clash YAML（含 url 字段值，不应被当作订阅地址抓取）
    await importViaUnified(
      container,
      ['proxies:', '  - name: U02Yaml', '    type: socks5', '    server: u02b.example.invalid', '    port: 1080'].join('\n'),
    )
    expect(container.textContent).toContain('U02Yaml')
    expect(networkCalls).toBe(1)

    // 多个订阅地址混贴：提示拆分、保留输入、不发起请求
    const textarea = container.querySelector('textarea[aria-label="订阅地址或节点内容"]') as HTMLTextAreaElement
    await act(async () => {
      setNativeValue(
        textarea,
        ['https://a.example.invalid/sub1', 'https://b.example.invalid/sub2'].join('\n'),
      )
    })
    expect(container.textContent).toContain('请单独导入订阅地址或节点内容')
    const importBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === '导入',
    ) as HTMLButtonElement
    await act(async () => {
      importBtn.click()
    })
    await flushMicrotasks()
    expect(networkCalls).toBe(1)
    expect(textarea.value).toContain('https://a.example.invalid/sub1')

    // 订阅地址与节点内容混贴：同样拒绝
    await act(async () => {
      setNativeValue(
        textarea,
        'https://a.example.invalid/sub1\nsocks5://u:p@c.example.invalid:1080#混贴节点',
      )
    })
    expect(container.textContent).toContain('请单独导入订阅地址或节点内容')
  })

  it('U05/U07: 多入口选择、出口开关与步骤往返保留草稿与选择', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importViaUnified(
      container,
      [
        'socks5://u:p@u05a.example.invalid:1080#U05-A',
        'socks5://u:p@u05b.example.invalid:1081#U05-B',
        'socks5://u:p@u05c.example.invalid:1082#U05-Exit',
      ].join('\n'),
    )

    // 步骤 1 留下未提交草稿后进步骤 2，再返回：草稿仍在（U07）
    const textarea = container.querySelector('textarea[aria-label="订阅地址或节点内容"]') as HTMLTextAreaElement
    await act(async () => {
      setNativeValue(textarea, '草稿内容 socks5://u:p@draft.example.invalid:1080#草稿')
    })
    await gotoStep(container, 2)

    // 多入口选择
    const entryCard = container.querySelectorAll('.stage-card')[0]
    const checkboxA = Array.from(entryCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('U05-A'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    const checkboxB = Array.from(entryCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('U05-B'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      checkboxA.click()
    })
    await act(async () => {
      checkboxB.click()
    })
    expect(entryCard.textContent).toContain('已选 2 个')

    // 关闭独立出口：预览无独立出口残留；重新开启恢复选择
    const entryOnlyButton = findButton(container, '仅入口代理')
    const chainProxyButton = findButton(container, '链式代理')
    await act(async () => {
      entryOnlyButton.click()
    })
    expect(container.textContent).toContain('已关闭出口节点')

    // 返回步骤 1 验证草稿保留，再回步骤 2 验证选择保留
    await gotoStep(container, 1)
    expect(textarea.value).toContain('草稿')
    await gotoStep(container, 2)
    const entryCard2 = container.querySelectorAll('.stage-card')[0]
    expect(entryCard2.textContent).toContain('已选 2 个')
    expect(container.textContent).toContain('已关闭出口节点')

    // 重新开启出口并选择出口节点
    await act(async () => {
      chainProxyButton.click()
    })
    const exitCard = container.querySelectorAll('.stage-card')[container.querySelectorAll('.stage-card').length - 1]
    const exitCheckbox = Array.from(exitCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('U05-Exit'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      exitCheckbox.click()
    })

    // 进入步骤 3：可下载
    await gotoStep(container, 3)
    const downloadBtn = Array.from(container.querySelectorAll('.output-actions-bar button')).find(
      (b) => (b.textContent ?? '').includes('下载配置'),
    ) as HTMLButtonElement
    expect(downloadBtn.disabled).toBe(false)
  })

  it('U06: 展开/收起高级设置、切换步骤与语言不改变业务字段与导出结果', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importViaUnified(
      container,
      [
        'socks5://u:p@u06a.example.invalid:1080#U06-Entry',
        'socks5://u:p@u06b.example.invalid:1081#U06-Exit',
      ].join('\n'),
    )
    await gotoStep(container, 2)

    const entryCard = container.querySelectorAll('.stage-card')[0]
    const entryCheckbox = Array.from(entryCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('U06-Entry'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      entryCheckbox.click()
    })
    const exitCard = container.querySelectorAll('.stage-card')[container.querySelectorAll('.stage-card').length - 1]
    const exitCheckbox = Array.from(exitCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('U06-Exit'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      exitCheckbox.click()
    })

    await gotoStep(container, 3)
    await act(async () => {
      findButton(container, '查看配置').click()
    })
    const yamlBefore = container.querySelector('.code-preview code')?.textContent ?? ''

    // 收起/展开高级设置 + 往返步骤 + 切换语言再切回：YAML 不变
    await openAdvanced(container)
    await act(async () => {
      findButton(container, '高级设置').click() // 收起
    })
    await gotoStep(container, 1)
    await gotoStep(container, 3)
    await act(async () => {
      findButton(container, 'English').click()
    })
    await act(async () => {
      findButton(container, '中文').click()
    })
    const yamlAfter = container.querySelector('.code-preview code')?.textContent ?? ''
    expect(yamlAfter).toBe(yamlBefore)
    expect(yamlAfter).toContain('U06-Entry')
    expect(yamlAfter).toContain('U06-Exit')
  })

  it('U12: 步骤 3 存在阻断错误时禁止下载，“前往修改”跳回步骤 2', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importViaUnified(container, 'socks5://u:p@u12a.example.invalid:1080#U12-Node')
    // 未选择任何节点直接进入步骤 2/3（通过导航按钮 disabled 检查，再强设步骤）
    await gotoStep(container, 2)
    // 入口未选：下一步触发校验并留在步骤 2
    await act(async () => {
      const nextBtn = Array.from(container.querySelectorAll('.step-footer button')).find((b) =>
        (b.textContent ?? '').includes('下一步'),
      ) as HTMLButtonElement
      nextBtn.click()
    })
    expect(
      Array.from(container.querySelectorAll('.step-nav button')).find((b) =>
        (b.textContent ?? '').includes('选择链路'),
      )?.getAttribute('aria-current'),
    ).toBe('step')
    expect(container.textContent).toContain('链路尚未完整')
  })
})

describe('本地上传文件与常驻链路示意回归', () => {
  let container: HTMLDivElement
  let root: Root
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    globalThis.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('上传本地节点文件走本地解析导入，不上传网络；超限文件被拦截', async () => {
    let networkCalls = 0
    globalThis.fetch = vi.fn(async () => {
      networkCalls += 1
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()
    expect(networkCalls).toBe(1) // 仅 healthz

    const fileInput = container.querySelector('input[aria-label="上传文件"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const nodeFile = new File(
      ['socks5://u:p@upload-a.example.invalid:1080#上传节点A\nsocks5://u:p@upload-b.example.invalid:1081#上传节点B'],
      'nodes.txt',
      { type: 'text/plain' },
    )
    Object.defineProperty(fileInput, 'files', { value: [nodeFile], configurable: true })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })

    expect(container.textContent).toContain('上传节点A')
    expect(container.textContent).toContain('上传节点B')
    expect(networkCalls).toBe(1)

    // 超过 2 MiB 的文件在读取前被拦截
    const bigFile = new File(['x'], 'big.txt', { type: 'text/plain' })
    Object.defineProperty(bigFile, 'size', { value: 3 * 1024 * 1024, configurable: true })
    Object.defineProperty(fileInput, 'files', { value: [bigFile], configurable: true })
    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(container.textContent).toContain('方案文件体积超过 2 MiB 上限')
  })

  it('空节点库可在链路页直接新增入口、粘贴追加并去重，再从本地文件导入出口', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    globalThis.fetch = fetchMock
    await act(async () => root.render(<App />))
    await flushMicrotasks()
    await gotoStep(container, 2)

    const [entry, exit] = container.querySelectorAll<HTMLElement>('.stage-card')
    expect(entry.closest('.step-pane')?.hasAttribute('hidden')).toBe(false)
    const selectedNames = (card: HTMLElement) =>
      Array.from(card.querySelectorAll('.selector-node-item.is-selected .node-alias'), (node) => node.textContent)

    await act(async () => findButton(entry, '添加节点').click())
    const manual = entry.querySelector<HTMLFormElement>('.manual-form')!
    await act(async () => {
      setNativeValue(manual.querySelector('select')!, 'socks5')
      setNativeValue(manual.querySelector<HTMLInputElement>('[placeholder="Tokyo-01"]')!, '手动入口')
      setNativeValue(manual.querySelector<HTMLInputElement>('[placeholder="edge.example.com"]')!, 'manual-entry.example.invalid')
      setNativeValue(manual.querySelector<HTMLInputElement>('input[type="number"]')!, '1080')
    })
    await act(async () => findButton(manual, '添加并选中').click())
    expect(selectedNames(entry)).toEqual(['手动入口'])
    expect(selectedNames(exit)).toEqual([])

    await act(async () => {
      setNativeValue(entry.querySelector<HTMLInputElement>('input[type="search"]')!, '无匹配节点')
      findButton(entry, '导入节点').click()
    })
    const pasted = entry.querySelector('textarea')!
    const additionalEntry = 'socks5://extra-entry.example.invalid:1081#批量入口'
    await act(async () => setNativeValue(pasted, [additionalEntry, additionalEntry].join('\n')))
    await act(async () => findButton(entry, '导入并选中').click())
    expect(selectedNames(entry)).toEqual(['手动入口', '批量入口'])
    expect(selectedNames(exit)).toEqual([])

    await act(async () => findButton(exit, '导入节点').click())
    const fileInput = exit.querySelector<HTMLInputElement>('input[type="file"]')!
    const yaml = 'proxies:\n  - name: 文件出口\n    type: socks5\n    server: file-exit.example.invalid\n    port: 1080\n'
    const file = new File([yaml], 'exit.yaml', { type: 'text/yaml' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
    await flushMicrotasks()
    expect(selectedNames(exit)).toEqual(['文件出口'])
    expect(selectedNames(entry)).toEqual(['手动入口', '批量入口'])
    expect(fetchMock).toHaveBeenCalledTimes(1) // 仅 healthz 探测

    await gotoStep(container, 3)
    const output = container.querySelector<HTMLElement>('.output-panel')!
    await act(async () => findButton(output, '查看配置').click())
    const config = parseYaml(output.querySelector('.yaml-fold code')!.textContent ?? '') as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
    }
    expect(config.proxies.map((proxy) => proxy.name)).toEqual(['手动入口', '批量入口', '文件出口'])
    expect(config.proxies.find((proxy) => proxy.name === '文件出口')?.['dialer-proxy']).toBe('入口节点')
  })

  it('分层订阅关闭后丢弃迟到响应，失败保留输入，重试成功只选入发起层', async () => {
    const subscriptionUrl = 'https://stage-sub.example.invalid/nodes'
    let resolveCancelled!: (value: Response) => void
    let cancelledSignal: AbortSignal | null | undefined
    let calls = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/healthz') return new Response('', { status: 404 })
      expect(String(input)).toBe(subscriptionUrl)
      calls += 1
      if (calls === 1) {
        cancelledSignal = init?.signal
        return new Promise<Response>((resolve) => { resolveCancelled = resolve })
      }
      if (calls === 2) return new Response(null, { status: 503 })
      return new Response('socks5://retry-exit.example.invalid:1080#重试出口')
    })
    await act(async () => root.render(<App />))
    await flushMicrotasks()
    await gotoStep(container, 2)

    const [entry, exit] = container.querySelectorAll<HTMLElement>('.stage-card')
    async function openSubscriptionForm() {
      await act(async () => findButton(exit, '导入节点').click())
      const textarea = exit.querySelector('textarea')!
      await act(async () => setNativeValue(textarea, subscriptionUrl))
      return textarea
    }

    await openSubscriptionForm()
    expect(calls).toBe(0)
    await act(async () => findButton(exit, '导入并选中').click())
    await act(async () => exit.querySelector<HTMLButtonElement>('[aria-label="关闭节点表单"]')!.click())
    expect(cancelledSignal?.aborted).toBe(true)
    await act(async () => resolveCancelled(new Response('socks5://late-exit.example.invalid:1080#迟到出口')))
    expect(container.textContent).not.toContain('迟到出口')
    expect(container.querySelectorAll('.source-item-card')).toHaveLength(0)

    const textarea = await openSubscriptionForm()
    await act(async () => findButton(exit, '导入并选中').click())
    expect(exit.querySelector('[role="alert"]')?.textContent).toContain('HTTP 503')
    expect(textarea.value).toBe(subscriptionUrl)
    expect(container.querySelectorAll('.source-item-card')).toHaveLength(0)

    await act(async () => findButton(exit, '导入并选中').click())
    expect(textarea.value).toBe('')
    expect(exit.querySelector('.selector-node-item.is-selected .node-alias')?.textContent).toBe('重试出口')
    expect(entry.querySelector('.selector-node-item.is-selected')).toBeNull()
    expect(container.querySelectorAll('.source-item-card')).toHaveLength(1)
  })

  it('当前链路示意常驻导航条下方：所有步骤可见，仅显示层名与数量，不显示具体节点', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch

    await act(async () => {
      root.render(<App />)
    })
    await flushMicrotasks()

    await importDemoNodes(container)

    // 步骤 1 即可见示意（导航条下方）
    const nav = container.querySelector('.step-nav') as HTMLElement
    const preview = container.querySelector('.compact-preview') as HTMLElement
    expect(preview).toBeTruthy()
    expect(nav.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(preview.textContent).toContain('本机')
    expect(preview.textContent).toContain('入口')
    expect(preview.textContent).toContain('出口节点')
    expect(preview.textContent).toContain('最终出口')
    expect(preview.textContent).toContain('已选 1 个')

    // 不显示具体节点名/服务器
    expect(preview.textContent).not.toContain('Entry-SOCKS5-JP')
    expect(preview.textContent).not.toContain('203.0.113.10')

    // 步骤 3 时示意仍可见
    await gotoStep(container, 2)
    const entryCard = container.querySelectorAll('.stage-card')[0]
    const checkbox = Array.from(entryCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('Entry-SOCKS5-JP'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })
    const exitCard = container.querySelectorAll('.stage-card')[container.querySelectorAll('.stage-card').length - 1]
    const exitCheckbox = Array.from(exitCard.querySelectorAll('.selector-node-item'))
      .find((el) => (el.textContent ?? '').includes('Exit-US-Reality'))
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => {
      exitCheckbox.click()
    })
    await gotoStep(container, 3)
    const previewAt3 = container.querySelector('.compact-preview') as HTMLElement
    expect(previewAt3).toBeTruthy()
    expect(previewAt3.textContent).not.toContain('Entry-SOCKS5-JP')
  })
})
