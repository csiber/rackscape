import type { Disk, Guest, NetDevice, Node, Snapshot } from './types'

// A believable, constantly-moving homelab so anyone can try Rackscape
// without a Proxmox cluster. Values drift with layered sine "noise" and the
// occasional guest crashes and recovers to show off alarms.

const GiB = 1024 ** 3
const MB = 1024 ** 2

interface GuestSeed {
  name: string
  type: 'lxc' | 'qemu'
  base: number // typical cpu load
  net: number // typical traffic, MB/s
  mem: number // GiB
}

const PVE1: GuestSeed[] = [
  { name: 'traefik', type: 'lxc', base: 0.08, net: 6, mem: 0.5 },
  { name: 'postgres', type: 'lxc', base: 0.25, net: 2, mem: 4 },
  { name: 'nats', type: 'lxc', base: 0.05, net: 1, mem: 0.5 },
  { name: 'vault', type: 'lxc', base: 0.03, net: 0.1, mem: 0.5 },
  { name: 'gitea', type: 'lxc', base: 0.06, net: 0.4, mem: 1 },
  { name: 'home-assistant', type: 'qemu', base: 0.15, net: 0.3, mem: 2 },
  { name: 'jellyfin', type: 'lxc', base: 0.35, net: 18, mem: 4 },
  { name: 'immich', type: 'lxc', base: 0.2, net: 3, mem: 4 },
  { name: 'nextcloud', type: 'lxc', base: 0.1, net: 2, mem: 2 },
  { name: 'pihole', type: 'lxc', base: 0.02, net: 0.2, mem: 0.25 },
  { name: 'grafana', type: 'lxc', base: 0.04, net: 0.2, mem: 0.5 },
  { name: 'prometheus', type: 'lxc', base: 0.12, net: 0.8, mem: 2 },
]

const PVE2: GuestSeed[] = [
  { name: 'minecraft', type: 'lxc', base: 0.45, net: 1.5, mem: 8 },
  { name: 'win11-gpu', type: 'qemu', base: 0.3, net: 4, mem: 16 },
  { name: 'paperless', type: 'lxc', base: 0.05, net: 0.2, mem: 2 },
  { name: 'vaultwarden', type: 'lxc', base: 0.01, net: 0.05, mem: 0.25 },
  { name: 'uptime-kuma', type: 'lxc', base: 0.03, net: 0.1, mem: 0.5 },
  { name: 'llm-runner', type: 'qemu', base: 0.6, net: 0.5, mem: 24 },
  { name: 'frigate', type: 'lxc', base: 0.4, net: 12, mem: 4 },
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967295
}

/** smooth pseudo-noise in 0..1 */
function wobble(t: number, seed: number) {
  const a = Math.sin(t * 0.31 + seed * 40) * 0.5
  const b = Math.sin(t * 0.87 + seed * 91) * 0.3
  const c = Math.sin(t * 2.3 + seed * 13) * 0.2
  return (a + b + c + 1) / 2
}

/** occasional bursts, mostly 0 */
function burst(t: number, seed: number) {
  const w = Math.sin(t * 0.13 + seed * 77)
  return w > 0.85 ? (w - 0.85) / 0.15 : 0
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

// Crash schedule: one guest at a time goes down for a while.
let crash: { id: string; until: number; next: number } = { id: '', until: 0, next: 150 } // t starts at 120

function guests(node: string, seeds: GuestSeed[], firstId: number, t: number): Guest[] {
  return seeds.map((g, i) => {
    const vmid = firstId + i
    const id = `${node}/${g.type}/${vmid}`
    const s = hash(id)
    const down = crash.id === id && t < crash.until
    const cpu = down ? 0 : clamp(g.base * (0.5 + wobble(t, s)) + burst(t, s) * 0.5)
    const traffic = down ? 0 : g.net * MB * (0.3 + wobble(t * 1.7, s + 1) * 1.4 + burst(t, s + 2) * 3)
    return {
      id,
      vmid,
      name: g.name,
      type: g.type,
      status: down ? 'stopped' : 'running',
      expected: true,
      cpu,
      mem: down ? 0 : g.mem * GiB * (0.55 + wobble(t * 0.2, s + 3) * 0.3),
      maxmem: g.mem * GiB,
      netIn: traffic * 0.7,
      netOut: traffic * 0.3,
      diskRead: down ? 0 : traffic * 0.2 * wobble(t * 3, s + 4),
      diskWrite: down ? 0 : traffic * 0.1 * wobble(t * 2.5, s + 5),
    }
  })
}

function disks(node: string, n: number, t: number): Disk[] {
  return Array.from({ length: n }, (_, i) => {
    const s = hash(`${node}-d${i}`)
    return {
      id: `${node}/disk/${i}`,
      label: `bay ${i}`,
      health: node === 'nas-01' && i === 7 ? 'warn' : 'ok',
      busy: clamp(wobble(t * 4, s) * 0.8 + burst(t * 3, s) * 0.6 - 0.2),
    }
  })
}

function node(id: string, kind: Node['kind'], gs: Guest[], ds: Disk[], maxcpu: number, maxmem: number, t: number): Node {
  const running = gs.filter((g) => g.status === 'running')
  const cpu = kind === 'storage' ? 0.08 + wobble(t, hash(id)) * 0.1 : running.reduce((a, g) => a + g.cpu, 0) / Math.max(4, gs.length * 0.7)
  return {
    id,
    name: id,
    kind,
    status: 'online',
    cpu: clamp(cpu),
    maxcpu,
    mem: kind === 'storage' ? maxmem * 0.4 : running.reduce((a, g) => a + g.mem, 0),
    maxmem,
    netIn: kind === 'storage' ? 40 * MB * wobble(t, 9) : running.reduce((a, g) => a + g.netIn, 0),
    netOut: kind === 'storage' ? 25 * MB * wobble(t, 8) : running.reduce((a, g) => a + g.netOut, 0),
    temp: 42 + cpu * 35 + wobble(t * 0.1, hash(id)) * 4,
    uptime: 86400 * 23 + t,
    guests: gs,
    disks: ds,
    ...(kind === 'storage' ? { capacity: { used: 21.4e12 + wobble(t * 0.01, 3) * 1e11, total: 48e12 } } : {}),
  }
}

const start = performance.now() / 1000

export function demoSnapshot(): Snapshot {
  const t = performance.now() / 1000 - start + 120

  const all = [...PVE1.map((g, i) => `pve-01/${g.type}/${100 + i}`), ...PVE2.map((g, i) => `pve-02/${g.type}/${200 + i}`)]
  if (t > crash.next) {
    const pick = all[Math.floor(Math.random() * all.length)]
    crash = { id: pick, until: t + 18, next: t + 55 + Math.random() * 30 }
  }

  const n1 = node('pve-01', 'hypervisor', guests('pve-01', PVE1, 100, t), disks('pve-01', 4, t), 16, 64 * GiB, t)
  const n2 = node('pve-02', 'hypervisor', guests('pve-02', PVE2, 200, t), disks('pve-02', 4, t), 24, 96 * GiB, t)
  const nas = node('nas-01', 'storage', [], disks('nas-01', 12, t), 4, 16 * GiB, t)

  const total = [n1, n2, nas].reduce((a, n) => a + n.netIn + n.netOut, 0)
  const sw: NetDevice = {
    id: 'switch-core',
    name: 'core-switch',
    kind: 'switch',
    ports: Array.from({ length: 24 }, (_, i) => {
      const up = i < 14 || i === 22 || i === 23
      return { up, rate: up ? total * 0.08 * wobble(t * 2, hash(`p${i}`)) : 0 }
    }),
  }
  const router: NetDevice = {
    id: 'router',
    name: 'gateway',
    kind: 'router',
    ports: Array.from({ length: 8 }, (_, i) => ({ up: i < 5, rate: i < 5 ? total * 0.05 * wobble(t, hash(`r${i}`)) : 0 })),
    wanIn: 30 * MB * (0.2 + wobble(t * 1.3, 0.4) + burst(t, 0.7) * 2),
    wanOut: 6 * MB * (0.2 + wobble(t * 1.1, 0.6)),
  }

  return { cluster: 'homelab', time: Date.now(), nodes: [n1, n2, nas], network: [router, sw] }
}
