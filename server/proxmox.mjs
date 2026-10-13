// Proxmox VE → Rackscape snapshot.
//
// Read-only: needs an API token with the PVEAuditor role on "/".
// Counters in /cluster/resources are cumulative, so rates are derived from
// the previous sample. Guest "onboot" flags and SMART health change rarely and
// are refreshed in the background.

import http from 'node:http'
import https from 'node:https'

const SLOW_REFRESH_MS = 5 * 60 * 1000
const SHARED_TYPES = new Set(['nfs', 'cifs', 'pbs', 'cephfs', 'rbd', 'iscsi', 'glusterfs'])

/** run async jobs with limited concurrency */
async function pool(jobs, size = 4) {
  const queue = [...jobs]
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await queue.shift()()
  }))
}

/**
 * @param {{ url: string, token: string, insecure?: boolean, ca?: string|Buffer, name?: string }} opts
 */
export function createProxmoxSource(opts) {
  const base = new URL(opts.url)
  const isHttps = base.protocol === 'https:'
  const agent = isHttps ? new https.Agent({ rejectUnauthorized: !opts.insecure, ca: opts.ca, keepAlive: true }) : new http.Agent({ keepAlive: true })

  /** @returns {Promise<any>} */
  function get(path) {
    const u = new URL(`/api2/json${path}`, base)
    return new Promise((resolve, reject) => {
      const req = (isHttps ? https : http).request(
        u,
        { agent, headers: { Authorization: `PVEAPIToken=${opts.token}` }, timeout: 8000 },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            if (res.statusCode !== 200) return reject(new Error(`Proxmox ${path}: HTTP ${res.statusCode}`))
            try {
              resolve(JSON.parse(body).data)
            } catch (e) {
              reject(e)
            }
          })
        },
      )
      req.on('timeout', () => req.destroy(new Error(`Proxmox ${path}: timeout`)))
      req.on('error', reject)
      req.end()
    })
  }

  /** @type {Map<string, {t:number, netin:number, netout:number, diskread:number, diskwrite:number}>} */
  const prev = new Map()
  /** @type {Map<string, boolean>} guest id → onboot */
  const onboot = new Map()
  /** @type {Map<string, any[]>} node → disks/list */
  const disks = new Map()
  const seenRunning = new Set()
  let slowAt = 0
  let clusterName = opts.name ?? ''

  function rate(id, cur, now) {
    const p = prev.get(id)
    prev.set(id, { t: now, netin: cur.netin ?? 0, netout: cur.netout ?? 0, diskread: cur.diskread ?? 0, diskwrite: cur.diskwrite ?? 0 })
    if (!p) return { netIn: 0, netOut: 0, diskRead: 0, diskWrite: 0 }
    const dt = Math.max(0.5, (now - p.t) / 1000)
    const d = (k) => Math.max(0, ((cur[k] ?? 0) - p[k]) / dt) // counter resets → 0
    return { netIn: d('netin'), netOut: d('netout'), diskRead: d('diskread'), diskWrite: d('diskwrite') }
  }

  async function refreshSlow(resources) {
    slowAt = Date.now()
    let failed = false
    const guests = resources.filter((r) => (r.type === 'lxc' || r.type === 'qemu') && !r.template)
    const nodes = resources.filter((r) => r.type === 'node' && r.status === 'online')
    // drives first (they matter most), then onboot flags, a few requests at a time
    await pool(
      nodes.map((n) => async () => {
        try {
          disks.set(n.node, await get(`/nodes/${n.node}/disks/list`))
        } catch {
          failed = true // needs Sys.Audit; until then the rack shows no drive bays
        }
      }),
    )
    await pool(
      guests.map((g) => async () => {
        try {
          const cfg = await get(`/nodes/${g.node}/${g.type}/${g.vmid}/config`)
          onboot.set(`${g.node}/${g.type}/${g.vmid}`, Number(cfg.onboot ?? 0) === 1)
        } catch {
          failed = true // keep the last known value
        }
      }),
    )
    if (failed) slowAt = Date.now() - SLOW_REFRESH_MS + 30_000 // retry in 30 s
    if (!clusterName) {
      try {
        const st = await get('/cluster/status')
        clusterName = st.find((x) => x.type === 'cluster')?.name ?? ''
      } catch {
        /* standalone node */
      }
    }
  }

  return async function snapshot() {
    const now = Date.now()
    /** @type {any[]} */
    const res = await get('/cluster/resources')
    if (now - slowAt > SLOW_REFRESH_MS) {
      const p = refreshSlow(res)
      if (!slowAt || onboot.size === 0) await p // first run: wait so alarms are right
    }

    const nodes = res
      .filter((r) => r.type === 'node')
      .sort((a, b) => a.node.localeCompare(b.node))
      .map((n) => {
        const guests = res
          .filter((g) => (g.type === 'lxc' || g.type === 'qemu') && g.node === n.node && !g.template)
          .sort((a, b) => a.vmid - b.vmid)
          .map((g) => {
            const id = `${g.node}/${g.type}/${g.vmid}`
            if (g.status === 'running') seenRunning.add(id)
            const r = rate(id, g, now)
            const ob = onboot.get(id)
            return {
              id,
              vmid: g.vmid,
              name: g.name ?? `${g.type}-${g.vmid}`,
              type: g.type,
              status: g.status === 'running' || g.status === 'stopped' || g.status === 'paused' ? g.status : 'unknown',
              // expected to run: onboot=1, or (unknown config) we saw it running earlier
              expected: ob ?? seenRunning.has(id),
              cpu: Math.min(1, g.cpu ?? 0),
              mem: g.mem ?? 0,
              maxmem: g.maxmem ?? 0,
              ...r,
            }
          })
        const sum = (k) => guests.reduce((a, g) => a + g[k], 0)
        const io = sum('diskRead') + sum('diskWrite')
        const dl = disks.get(n.node) ?? []
        return {
          id: n.node,
          name: n.node,
          kind: 'hypervisor',
          status: n.status === 'online' ? 'online' : 'offline',
          cpu: Math.min(1, n.cpu ?? 0),
          maxcpu: n.maxcpu ?? 0,
          mem: n.mem ?? 0,
          maxmem: n.maxmem ?? 0,
          netIn: sum('netIn'),
          netOut: sum('netOut'),
          uptime: n.uptime ?? 0,
          guests,
          disks: dl
            .filter((d) => d.type !== 'usb')
            .map((d, i) => ({
              id: `${n.node}/disk/${i}`,
              label: `${d.devpath?.replace('/dev/', '') ?? `disk ${i}`} ${d.model ?? ''}`.trim(),
              health: /PASSED|OK/i.test(d.health ?? '') ? 'ok' : d.health && d.health !== 'UNKNOWN' ? 'fail' : 'warn',
              // no per-disk IO in the API: spread the node's guest IO across drives
              busy: Math.min(1, (Math.log10(io + 1) - 3) / 5) * (0.6 + Math.random() * 0.4),
            })),
        }
      })

    // Shared storage (NAS, PBS, Ceph) becomes appliances in a storage rack.
    const shared = new Map()
    for (const s of res.filter((r) => r.type === 'storage' && (r.shared || SHARED_TYPES.has(r.plugintype)))) {
      if (!shared.has(s.storage)) shared.set(s.storage, s) // listed once per node
    }
    for (const s of shared.values()) {
      nodes.push({
        id: `storage/${s.storage}`,
        name: s.storage,
        kind: 'storage',
        status: s.status === 'available' ? 'online' : 'offline',
        cpu: 0,
        maxcpu: 0,
        mem: 0,
        maxmem: 0,
        netIn: 0,
        netOut: 0,
        uptime: 0,
        capacity: { used: s.disk ?? 0, total: s.maxdisk ?? 0 },
        guests: [],
        disks: [],
      })
    }

    // Proxmox knows nothing about switches: model one uplink port per node.
    const network = [
      {
        id: 'uplinks',
        name: 'uplinks',
        kind: 'switch',
        ports: nodes.map((n) => ({ up: n.status === 'online', rate: n.netIn + n.netOut })),
      },
    ]

    return { cluster: clusterName || nodes[0]?.name || 'proxmox', time: now, nodes, network }
  }
}
