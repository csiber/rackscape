import { useEffect } from 'react'
import { demoSnapshot } from './demo'
import type { Snapshot } from './types'
import { useStore } from '../store'

// Where snapshots come from:
//   demo (default)        — built-in simulated homelab, no backend needed
//   ?source=api / VITE_SOURCE=api — poll the Rackscape server (/api/snapshot)

const params = new URLSearchParams(location.search)
export const SOURCE = params.get('source') ?? import.meta.env.VITE_SOURCE ?? 'demo'

export function useDataSource() {
  const setSnap = useStore((s) => s.setSnap)
  useEffect(() => {
    if (SOURCE === 'demo') {
      setSnap(demoSnapshot())
      const id = setInterval(() => setSnap(demoSnapshot()), 500)
      return () => clearInterval(id)
    }
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const r = await fetch(import.meta.env.BASE_URL + 'api/snapshot', { cache: 'no-store' })
        if (r.ok) setSnap((await r.json()) as Snapshot)
      } catch {
        // keep showing the last snapshot; the HUD marks it stale
      }
      if (!stop) timer = setTimeout(poll, 2000)
    }
    poll()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [setSnap])
}
