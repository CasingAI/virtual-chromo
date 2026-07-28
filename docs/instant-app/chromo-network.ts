/**
 * Reference SDK for instant-app — copy to:
 *   instant-app/src/apps/chromo/chromo-network.ts
 *
 * Network DevTools helper (VC_NETWORK_UPDATED + VC_NETWORK_READ + body cache).
 *
 * Hot cache (SW `vc-net-hot`) is session-scoped: key = sessionId + method + url
 * (normalized). Redirects keep the original request URL as the hot key.
 * `devtoolsId` only binds Disable cache; it is not part of the hot key.
 * First eligible GET writes but does not hit (`hotStored` may be true);
 * subsequent same-URL GETs in the same session may return fromCache / source: 'cache'.
 * Use VC_NETWORK_HOT_PROBE to check whether SW already has an entry for a URL.
 */

export type NetworkTiming = {
  queuedAt?: number
  startedAt?: number
  responseAt?: number
  finishedAt?: number
  queueing?: number
  waiting?: number
  download?: number
}

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
  pending?: boolean
  hasBody?: boolean
  /** Whether this response was written to session hot cache. */
  hotStored?: boolean
  fromCache?: boolean
  devtoolsId?: string
  requestHeaders?: Record<string, string>
  requestHeadersTruncated?: boolean
  referrer?: string
  referrerPolicy?: string
  timing?: NetworkTiming
  source?: string
  sourceHost?: string
  errorCode?: string
  errorText?: string
}

export type NetworkReadResult = {
  entries: NetworkEntry[]
  latestId: string | null
}

export type NetworkBodyReadResult = {
  headers: Record<string, string>
  body: string
  encoding: 'base64' | 'text'
  status: number
  truncated?: boolean
}

export type NetworkBodyReadLinesResult = {
  headers: Record<string, string>
  status: number
  totalLines: number
  fromLine: number
  toLine: number
  lines: string[]
  contentType?: string
  charset?: string
  rangeClamped?: boolean
}

export type NetworkOptions = {
  /** Parent-tab id for Disable cache isolation only (not part of hot cache key). */
  devtoolsId?: string
  disableCache?: boolean
}

const DEFAULT_RPC_TIMEOUT = 30_000

export function createChromoNetwork(
  iframe: HTMLIFrameElement,
  options: { targetOrigin?: string; timeout?: number; devtoolsId?: string } = {},
) {
  const targetOrigin = options.targetOrigin ?? '*'
  const timeout = options.timeout ?? DEFAULT_RPC_TIMEOUT
  const devtoolsId = options.devtoolsId ?? crypto.randomUUID()
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

  function setOptions(opts: NetworkOptions = {}) {
    iframe.contentWindow?.postMessage(
      [
        'VC_NETWORK_OPTIONS',
        {
          devtoolsId: opts.devtoolsId ?? devtoolsId,
          disableCache: !!opts.disableCache,
        },
      ],
      targetOrigin,
    )
  }

  return {
    devtoolsId,

    getLastSeenId(): string {
      return lastSeenId
    },

    setOptions,

    onUpdated(cb: (payload: { latestId: string; count: number; entry?: NetworkEntry }) => void): () => void {
      function onMessage(event: MessageEvent) {
        if (event.source !== iframe.contentWindow) return
        if (!Array.isArray(event.data)) return
        const [cmd, payload] = event.data as [string, { latestId?: string; count?: number; entry?: NetworkEntry }]
        if (cmd !== 'VC_NETWORK_UPDATED') return
        cb({
          latestId: payload?.latestId ?? '',
          count: payload?.count ?? 0,
          entry: payload?.entry,
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

    async readBody(entryId: string): Promise<NetworkBodyReadResult> {
      return vcRpc<NetworkBodyReadResult>('VC_NETWORK_BODY_READ_RESULT', 'VC_NETWORK_BODY_READ', {
        entryId,
      })
    },

    async readBodyLines(
      entryId: string,
      opts: { fromLine?: number; toLine?: number; metaOnly?: boolean } = {},
    ): Promise<NetworkBodyReadLinesResult> {
      return vcRpc<NetworkBodyReadLinesResult>(
        'VC_NETWORK_BODY_READ_LINES_RESULT',
        'VC_NETWORK_BODY_READ_LINES',
        {
          entryId,
          ...opts,
        },
      )
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
