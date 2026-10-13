// Normalised snapshot of a homelab. Every data source (demo, Proxmox, ...)
// produces this shape; the scene never talks to an API directly.

export type Status = 'running' | 'stopped' | 'paused' | 'unknown'

export interface Guest {
  id: string // stable, e.g. "pve-01/lxc/101"
  vmid: number
  name: string
  type: 'lxc' | 'qemu'
  status: Status
  /** true when the guest is expected to run (onboot / was running) — a stopped
   *  guest with expected=true raises an alarm */
  expected: boolean
  cpu: number // 0..1 of its own allocation
  mem: number // bytes
  maxmem: number
  netIn: number // bytes/s
  netOut: number
  diskRead: number // bytes/s
  diskWrite: number
}

export interface Disk {
  id: string
  label: string
  health: 'ok' | 'warn' | 'fail'
  busy: number // 0..1 activity
}

export interface Node {
  id: string
  name: string
  kind: 'hypervisor' | 'storage'
  status: 'online' | 'offline'
  cpu: number // 0..1
  maxcpu: number
  mem: number
  maxmem: number
  netIn: number
  netOut: number
  temp?: number // °C
  uptime: number // s
  /** storage appliances (NAS, PBS, shared pools): used / total bytes */
  capacity?: { used: number; total: number }
  guests: Guest[]
  disks: Disk[]
}

export interface NetDevice {
  id: string
  name: string
  kind: 'router' | 'switch'
  ports: { up: boolean; rate: number }[] // rate: bytes/s
  wanIn?: number
  wanOut?: number
}

export interface Snapshot {
  cluster: string
  time: number
  nodes: Node[]
  network: NetDevice[]
}

export interface Alarm {
  id: string // guest or node id
  nodeId: string
  message: string
  since: number
}
