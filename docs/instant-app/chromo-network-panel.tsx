/**
 * Reference React panel for instant-app — copy to:
 *   instant-app/src/apps/chromo/chromo-network-panel.tsx
 *
 * Usage:
 *   const net = useMemo(() => createChromoNetwork(iframeRef.current!), [iframeRef])
 *   <ChromoNetworkPanel network={net} active={devtoolsTab === 'network'} />
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChromoNetwork,
  formatNetworkBytes,
  networkEntryName,
  type NetworkEntry,
} from './chromo-network'

type ChromoNetwork = ReturnType<typeof createChromoNetwork>

type Props = {
  network: ChromoNetwork
  active: boolean
}

export function ChromoNetworkPanel({ network, active }: Props) {
  const [entries, setEntries] = useState<NetworkEntry[]>([])
  const [selected, setSelected] = useState<NetworkEntry | null>(null)
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pull = useCallback(async () => {
    const value = await network.read()
    if (value.entries.length) {
      setEntries((prev) => [...prev, ...value.entries])
    }
  }, [network])

  useEffect(() => {
    if (!active) return
    pull()
  }, [active, pull])

  useEffect(() => {
    if (!active) return
    const off = network.onUpdated(() => {
      if (pullTimer.current) clearTimeout(pullTimer.current)
      pullTimer.current = setTimeout(() => {
        pullTimer.current = null
        pull()
      }, 50)
    })
    return () => {
      off()
      if (pullTimer.current) clearTimeout(pullTimer.current)
    }
  }, [active, network, pull])

  useEffect(() => {
    if (!active) {
      setEntries([])
      setSelected(null)
      network.clearLocal()
    }
  }, [active, network])

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 px-3 py-2 text-xs font-medium text-slate-400">
        Network
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px]">
        {entries.length === 0 ? (
          <div className="p-4 text-center text-slate-500">暂无网络请求</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              className={[
                'block w-full border-b border-slate-900 px-3 py-2 text-left hover:bg-slate-900',
                entry.failed ? 'border-l-2 border-l-red-500' : '',
                entry.bypass ? 'border-l-2 border-l-amber-500' : '',
                selected?.id === entry.id ? 'bg-slate-900' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="text-slate-400">
                {entry.method} {entry.status} · {entry.type || 'other'} ·{' '}
                {formatNetworkBytes(entry.size)} · {entry.duration}ms
                {entry.bypass ? ' · bypass' : ''}
              </div>
              <div className="truncate text-slate-200">{networkEntryName(entry.url)}</div>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-slate-800 p-2 text-[10px] text-slate-500 break-all">
        {selected?.url ?? '点击行查看完整 URL'}
      </div>
    </div>
  )
}
