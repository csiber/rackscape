import { useEffect } from 'react'
import { demoSnapshot } from './demo'
import type { Snapshot } from './types'
import { useStore } from '../store'

// Where snapshots come from:
//   auto (default) — use the Rackscape server's /api/snapshot when it answers,
//                    otherwise fall back to the built-in demo homelab
//   ?source=demo   — always demo
//   ?source=api    — always the server (shows "stale" if it is down)

const params = new URLSearchParams(location.search)
const WANT = params.get('source') ?? import.meta.env.VITE_SOURCE ?? 'auto'
const API = import.meta.env.BASE_URL + 'api/snapshot'

async function fetchSnapshot(): Promise<Snapshot | null> {
  try {
    const r = await fetch(API, { cache: 'no-store' })
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
    return (await r.json()) as Snapshot
  } catch {
    return null
  }
}

export function useDataSource() {
  const setSnap = useStore((s) => s.setSnap)
  const setSource = useStore((s) => s.setSource)
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const demo = () => {
      setSource('demo')
      const tick = () => {
        if (stop) return
        setSnap(demoSnapshot())
        timer = setTimeout(tick, 500)
      }
      tick()
    }

    const api = async (first: Snapshot | null) => {
      setSource('api')
      if (first) setSnap(first)
      const poll = async () => {
        if (stop) return
        const s = await fetchSnapshot()
        if (s) setSnap(s) // on failure keep the last one; the HUD marks it stale
        timer = setTimeout(poll, 2000)
      }
      timer = setTimeout(poll, 2000)
    }

    if (WANT === 'demo') demo()
    else
      fetchSnapshot().then((s) => {
        if (stop) return
        if (s || WANT === 'api') api(s)
        else demo()
      })

    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [setSnap, setSource])
}
