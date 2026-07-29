/**
 * Reference SDK for instant-app — copy to:
 *   instant-app/src/apps/chromo/chromo-debug.ts
 *
 * - VC_DEBUG_PANEL: show/hide viewer floating DebugPanel (green 「调」)
 * - VC_DEBUG_OPTIONS + VC_DEBUG_NAV: navigation probe
 *
 * When navProbe is on, virtual-chromo suppresses VC_CLICK / VC_LOCATION /
 * VC_HISTORY to the parent and emits VC_DEBUG_NAV with a filtered stack.
 * Do NOT createTab / VC_NAVIGATE from VC_DEBUG_NAV.
 */

export type DebugOptions = {
  navProbe?: boolean
}

export type DebugNavEvent = {
  kind: 'CLICK' | 'LOCATION' | 'HISTORY' | string
  ts: number
  method?: string
  url?: string
  href?: string
  target?: string
  tagName?: string
  text?: string
  title?: string
  stack?: string[]
}

export function createChromoDebug(
  iframe: HTMLIFrameElement,
  options: { targetOrigin?: string } = {},
) {
  const targetOrigin = options.targetOrigin ?? '*'
  let navProbe = false
  let debugPanelEnabled = false

  function setDebugOptions(opts: DebugOptions = {}) {
    if (typeof opts.navProbe === 'boolean') {
      navProbe = opts.navProbe
    }
    iframe.contentWindow?.postMessage(
      [
        'VC_DEBUG_OPTIONS',
        {
          navProbe: !!navProbe,
        },
      ],
      targetOrigin,
    )
  }

  function setDebugPanelEnabled(enabled: boolean) {
    debugPanelEnabled = !!enabled
    iframe.contentWindow?.postMessage(
      ['VC_DEBUG_PANEL', { enabled: debugPanelEnabled }],
      targetOrigin,
    )
  }

  return {
    isNavProbeEnabled(): boolean {
      return navProbe
    },

    isDebugPanelEnabled(): boolean {
      return debugPanelEnabled
    },

    setDebugOptions,

    setDebugPanelEnabled,

    setNavProbe(enabled: boolean) {
      setDebugOptions({ navProbe: enabled })
    },

    onDebugNav(cb: (payload: DebugNavEvent) => void): () => void {
      function onMessage(event: MessageEvent) {
        if (event.source !== iframe.contentWindow) return
        if (!Array.isArray(event.data)) return
        const [cmd, payload] = event.data as [string, DebugNavEvent]
        if (cmd !== 'VC_DEBUG_NAV' || !payload) return
        cb(payload)
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    },
  }
}
