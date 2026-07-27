/**
 * Reference SDK for instant-app — copy to:
 *   instant-app/src/apps/chromo/chromo-network.ts
 *
 * Network DevTools helper (VC_NETWORK_UPDATED + VC_NETWORK_READ).
 */

export type NetworkEntry = {
  id: string
  ts: number
  method: string
  url: string
  status: number
  type: string
  size: number
  duration: number
  failed: boolean
  bypass: boolean
}

export type NetworkReadResult = {
  entries: NetworkEntry[]
  latestId: string | null
}

const DEFAULT_RPC_TIMEOUT = 30_000

export function createChromoNetwork(
  iframe: HTMLIFrameElement,
  options: { targetOrigin?: string; timeout?: number } = {},
) {
  const targetOrigin = options.targetOrigin ?? '*'
  const timeout = options.timeout ?? DEFAULT_RPC_TIMEOUT
  let lastSeenId = ''

  function vcRpc<T>(resultCmd: string, cmd: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID()
      let settled = false

      function finish(fn: (arg: unknown) => void, arg: unknown) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        fn(arg)
      }

      const timer = setTimeout(() => {
        finish(reject, Object.assign(new Error(`${cmd} timed out`), { code: 'RPC_TIMEOUT', id, timeout }))
      }, timeout)

      function onMessage(event: MessageEvent) {
        if (event.source !== iframe.contentWindow) return
        if (!Array.isArray(event.data)) return
        const [resCmd, resPayload] = event.data as [string, { id?: string; ok?: boolean; value?: T; error?: { message?: string } }]
        if (resCmd !== resultCmd || !resPayload || resPayload.id !== id) return
        if (resPayload.ok) {
          finish(resolve, resPayload.value)
        } else {
          finish(
            reject,
            Object.assign(new Error(resPayload.error?.message ?? `${cmd} failed`), resPayload.error),
          )
        }
      }

      window.addEventListener('message', onMessage)
      iframe.contentWindow?.postMessage([cmd, { id, ...payload }], targetOrigin)
    })
  }

  return {
    getLastSeenId(): string {
      return lastSeenId
    },

    onUpdated(cb: (payload: { latestId: string; count: number }) => void): () => void {
      function onMessage(event: MessageEvent) {
        if (event.source !== iframe.contentWindow) return
        if (!Array.isArray(event.data)) return
        const [cmd, payload] = event.data as [string, { latestId?: string; count?: number }]
        if (cmd !== 'VC_NETWORK_UPDATED') return
        cb({
          latestId: payload?.latestId ?? '',
          count: payload?.count ?? 0,
        })
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    },

    async read(opts: { after?: string; limit?: number } = {}): Promise<NetworkReadResult> {
      const value = await vcRpc<NetworkReadResult>('VC_NETWORK_READ_RESULT', 'VC_NETWORK_READ', {
        after: opts.after ?? lastSeenId,
        limit: opts.limit ?? 100,
      })
      if (value?.latestId) {
        lastSeenId = value.latestId
      }
      return value ?? { entries: [], latestId: lastSeenId || null }
    },

    clearLocal(): void {
      lastSeenId = ''
    },
  }
}

export function formatNetworkBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

export function networkEntryName(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname === '/' ? u.host : u.pathname
  } catch {
    return url
  }
}
