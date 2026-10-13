import type { Snapshot } from '../data/types'

// Physical layout: turns a snapshot into racks and rack units.
// Units are measured in metres; 1U = 44.45 mm, a 42U cabinet.

export const U = 0.04445
export const RACK_W = 0.6
export const RACK_D = 1.0
export const PLINTH = 0.08
export const INNER_W = 0.482 // 19" mounting width
const SIZES = [24, 32, 42] // cabinet heights we pick from, in U

export type UnitKind = 'guest' | 'host' | 'disks' | 'switch' | 'router' | 'patch' | 'ups' | 'blank'

export interface RackUnit {
  id: string
  kind: UnitKind
  u: number // bottom U index, 0-based
  h: number // height in U
  label: string
  ref?: string // guest / node / net-device / disk-shelf id in the snapshot
}

export interface RackLayout {
  id: string
  title: string
  nodeId?: string
  position: [number, number, number]
  rotationY: number
  units: RackUnit[]
  /** cabinet size in U and overall height in metres (same for every rack) */
  size: number
  height: number
  /** world y the camera should aim at: middle of the populated units */
  focusY: number
}

export const rackHeight = (size: number) => size * U + 0.2 // frame + plinth

function fillBlanks(units: RackUnit[], rackId: string, size: number) {
  const used = new Array(size).fill(false)
  for (const u of units) for (let i = u.u; i < u.u + u.h && i < size; i++) used[i] = true
  used.forEach((v, i) => {
    if (!v) units.push({ id: `${rackId}/blank/${i}`, kind: 'blank', u: i, h: 1, label: '' })
  })
}

function focusOf(units: RackUnit[]) {
  const live = units.filter((u) => u.kind !== 'blank' && u.kind !== 'ups' && u.kind !== 'patch')
  if (!live.length) return 1
  const lo = Math.min(...live.map((u) => u.u))
  const hi = Math.max(...live.map((u) => u.u + u.h))
  return PLINTH + ((lo + hi) / 2) * U
}

type Draft = Omit<RackLayout, 'position' | 'rotationY' | 'size' | 'height' | 'focusY'>

export function computeLayout(s: Snapshot): RackLayout[] {
  // 1. hypervisor / storage racks, packed bottom-up
  const nodeRacks: Draft[] = []
  let maxUsed = 0
  for (const n of s.nodes) {
    const units: RackUnit[] = []
    let u = 2
    units.push({ id: `${n.id}/ups`, kind: 'ups', u: 0, h: 2, label: 'UPS' })
    if (n.disks.length) {
      const h = Math.max(1, Math.ceil(n.disks.length / 4))
      units.push({ id: `${n.id}/disks`, kind: 'disks', u, h, label: `${n.name} storage`, ref: n.id })
      u += h
    }
    units.push({ id: `${n.id}/host`, kind: 'host', u, h: 2, label: n.name, ref: n.id })
    u += 3 // leave a gap above the chassis
    for (const g of n.guests) {
      const h = g.type === 'qemu' ? 2 : 1
      if (u + h > SIZES[SIZES.length - 1] - 2) break // TODO: overflow into a second rack for large nodes
      units.push({ id: g.id, kind: 'guest', u, h, label: `${g.vmid}  ${g.name}`, ref: g.id })
      u += h
    }
    maxUsed = Math.max(maxUsed, u)
    nodeRacks.push({ id: n.id, title: n.name, nodeId: n.id, units })
  }
  const size = SIZES.find((x) => x >= maxUsed + 3) ?? SIZES[SIZES.length - 1]
  for (const r of nodeRacks) {
    r.units.push({ id: `${r.id}/patch`, kind: 'patch', u: size - 1, h: 1, label: '' })
    fillBlanks(r.units, r.id, size)
  }

  // 2. network rack, hung from the top
  const racks: Draft[] = []
  if (s.network.length) {
    const units: RackUnit[] = []
    let u = size - 2
    units.push({ id: 'net/patch-a', kind: 'patch', u: u--, h: 1, label: 'patch A' })
    for (const d of s.network) {
      const h = d.kind === 'router' ? 1 : Math.ceil(d.ports.length / 24)
      u -= h - 1
      units.push({ id: `net/${d.id}`, kind: d.kind, u, h, label: d.name, ref: d.id })
      u -= 1
      units.push({ id: `net/${d.id}/patch`, kind: 'patch', u: u--, h: 1, label: '' })
    }
    units.push({ id: 'net/ups', kind: 'ups', u: 0, h: 2, label: 'UPS' })
    fillBlanks(units, 'net', size)
    racks.push({ id: 'net', title: 'network', units })
  }
  racks.push(...nodeRacks)

  // 3. one row while it fits, then two rows facing each other across a cold aisle
  const perRow = racks.length > 7 ? Math.ceil(racks.length / 2) : racks.length
  const gap = 0.015
  const height = rackHeight(size)
  return racks.map((r, i): RackLayout => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const count = row === 0 ? Math.min(perRow, racks.length) : racks.length - perRow
    const x = (col - (count - 1) / 2) * (RACK_W + gap)
    const common = { ...r, size, height, focusY: focusOf(r.units) }
    return row === 0
      ? { ...common, position: [x, 0, 0], rotationY: 0 }
      : { ...common, position: [-x, 0, RACK_D + AISLE * 2], rotationY: Math.PI }
  })
}

/** cable tray height for a layout */
export const trayY = (racks: RackLayout[]) => (racks[0]?.height ?? 2) + 0.38

export const AISLE = 1.2 // distance from rack front to aisle centre

export function rowExtent(racks: RackLayout[]) {
  const xs = racks.map((r) => r.position[0])
  return { minX: Math.min(...xs) - RACK_W / 2, maxX: Math.max(...xs) + RACK_W / 2, rows: racks.some((r) => r.rotationY !== 0) ? 2 : 1 }
}

/** world-space y of the centre of a unit */
export const unitY = (u: number, h: number) => PLINTH + (u + h / 2) * U
