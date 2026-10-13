import { create } from 'zustand'
import type { Alarm, Snapshot } from './data/types'

export type CameraMode = 'cinematic' | 'free' | 'focus'

interface State {
  snap: Snapshot | null
  /** changes only when the physical layout must change (guests added etc.) */
  structureKey: string
  alarms: Alarm[]
  selected: string | null // rack id or unit id
  mode: CameraMode
  tv: boolean // hide all UI
  source: 'demo' | 'api' | null
  setSource: (s: 'demo' | 'api') => void
  setSnap: (s: Snapshot) => void
  select: (id: string | null) => void
  setMode: (m: CameraMode) => void
  setTv: (v: boolean) => void
}

function structureOf(s: Snapshot) {
  return [
    ...s.nodes.map((n) => `${n.id}:${n.kind}:${n.disks.length}:${n.guests.map((g) => g.id).join(',')}`),
    ...s.network.map((d) => `${d.id}:${d.ports.length}`),
  ].join('|')
}

function alarmsOf(s: Snapshot, prev: Alarm[]): Alarm[] {
  const now = Date.now()
  const since = (id: string) => prev.find((a) => a.id === id)?.since ?? now
  const out: Alarm[] = []
  for (const n of s.nodes) {
    if (n.status !== 'online') out.push({ id: n.id, nodeId: n.id, message: `${n.name} is offline`, since: since(n.id) })
    if ((n.temp ?? 0) > 85) out.push({ id: `${n.id}/temp`, nodeId: n.id, message: `${n.name} running hot (${Math.round(n.temp!)}°C)`, since: since(`${n.id}/temp`) })
    for (const g of n.guests)
      if (g.expected && g.status !== 'running')
        out.push({ id: g.id, nodeId: n.id, message: `${g.name} (${g.vmid}) is ${g.status}`, since: since(g.id) })
    for (const d of n.disks)
      if (d.health === 'fail') out.push({ id: d.id, nodeId: n.id, message: `${n.name} ${d.label} failed`, since: since(d.id) })
  }
  return out
}

export const useStore = create<State>((set, get) => ({
  snap: null,
  structureKey: '',
  alarms: [],
  selected: null,
  mode: 'cinematic',
  tv: new URLSearchParams(location.search).has('tv'), // ?tv starts in wall-display mode
  source: null,
  setSource: (source) => set({ source }),
  setSnap: (snap) => {
    const key = structureOf(snap)
    const alarms = alarmsOf(snap, get().alarms)
    set({ snap, alarms, ...(key !== get().structureKey ? { structureKey: key } : {}) })
  },
  select: (selected) => set({ selected, mode: selected ? 'focus' : get().mode === 'focus' ? 'free' : get().mode }),
  setMode: (mode) => set({ mode, ...(mode === 'cinematic' ? { selected: null } : {}) }),
  setTv: (tv) => set({ tv }),
}))

/** Read the latest snapshot without subscribing (for useFrame loops). */
export const snap = () => useStore.getState().snap
