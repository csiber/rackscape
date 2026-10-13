import type { Guest, NetDevice, Node, Snapshot } from './types'

export interface Lookup {
  guests: Map<string, Guest>
  nodes: Map<string, Node>
  net: Map<string, NetDevice>
}

let last: Snapshot | null = null
let cached: Lookup = { guests: new Map(), nodes: new Map(), net: new Map() }

/** id → entity maps, rebuilt once per snapshot (cheap to call every frame). */
export function lookup(s: Snapshot | null): Lookup {
  if (!s) return cached
  if (s === last) return cached
  last = s
  cached = { guests: new Map(), nodes: new Map(), net: new Map() }
  for (const n of s.nodes) {
    cached.nodes.set(n.id, n)
    for (const g of n.guests) cached.guests.set(g.id, g)
  }
  for (const d of s.network) cached.net.set(d.id, d)
  return cached
}

export function fmtRate(b: number) {
  if (b < 1024) return `${b.toFixed(0)} B/s`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB/s`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB/s`
  return `${(b / 1024 ** 3).toFixed(2)} GB/s`
}

export function fmtBytes(b: number) {
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`
  return `${(b / 1024 ** 3).toFixed(1)} GB`
}

/** 0..1 activity from a byte rate, log-scaled so 1 KB/s and 1 GB/s both read */
export function activity(rate: number) {
  if (rate <= 0) return 0
  return Math.min(1, Math.max(0, (Math.log10(rate) - 2.5) / 6))
}
