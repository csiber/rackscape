import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createProxmoxSource } from '../proxmox.mjs'

// A tiny fake Proxmox API with counters that advance between calls.
function fakePve() {
  let calls = 0
  const seen = []
  const resources = () => {
    const k = calls
    return [
      { id: 'node/pve1', type: 'node', node: 'pve1', status: 'online', cpu: 0.2, maxcpu: 8, mem: 8e9, maxmem: 32e9, uptime: 1000 },
      { id: 'lxc/101', type: 'lxc', node: 'pve1', vmid: 101, name: 'web', status: 'running', cpu: 0.05, mem: 1e8, maxmem: 1e9, netin: 1e6 + k * 2e6, netout: 5e5 + k * 1e6, diskread: 0, diskwrite: k * 1e5, template: 0 },
      { id: 'lxc/102', type: 'lxc', node: 'pve1', vmid: 102, name: 'db', status: 'stopped', cpu: 0, mem: 0, maxmem: 2e9, netin: 0, netout: 0, template: 0 },
      { id: 'lxc/103', type: 'lxc', node: 'pve1', vmid: 103, name: 'scratch', status: 'stopped', cpu: 0, mem: 0, maxmem: 1e9, template: 0 },
      { id: 'qemu/900', type: 'qemu', node: 'pve1', vmid: 900, name: 'tmpl', status: 'stopped', template: 1 },
      { id: 'storage/pve1/nas', type: 'storage', node: 'pve1', storage: 'nas', status: 'available', disk: 2e12, maxdisk: 8e12, plugintype: 'nfs', shared: 1 },
      { id: 'storage/pve1/local', type: 'storage', node: 'pve1', storage: 'local', status: 'available', disk: 1e9, maxdisk: 4e10, plugintype: 'dir', shared: 0 },
    ]
  }
  const routes = {
    '/api2/json/cluster/resources': () => (calls++, resources()),
    '/api2/json/cluster/status': () => [{ type: 'node', name: 'pve1' }],
    '/api2/json/nodes/pve1/lxc/101/config': () => ({ onboot: 1 }),
    '/api2/json/nodes/pve1/lxc/102/config': () => ({ onboot: 1 }),
    '/api2/json/nodes/pve1/lxc/103/config': () => ({}),
    '/api2/json/nodes/pve1/disks/list': () => [
      { devpath: '/dev/sda', model: 'SSD_A', health: 'PASSED', type: 'ssd' },
      { devpath: '/dev/sdb', model: 'HDD_B', health: 'FAILED', type: 'hdd' },
      { devpath: '/dev/sdc', model: 'STICK', health: 'UNKNOWN', type: 'usb' },
    ],
  }
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization })
    const h = routes[req.url]
    if (!h) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: h() }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })))
}

test('maps Proxmox resources to a snapshot', async () => {
  const pve = await fakePve()
  try {
    const snapshot = createProxmoxSource({ url: pve.url, token: 'u@pve!t=secret' })
    const s1 = await snapshot()
    assert.equal(s1.cluster, 'pve1')
    assert.ok(pve.seen.every((r) => r.auth === 'PVEAPIToken=u@pve!t=secret'))

    const [node, nas] = s1.nodes
    assert.equal(node.kind, 'hypervisor')
    assert.deepEqual(node.guests.map((g) => g.vmid), [101, 102, 103], 'templates are skipped')
    const g = Object.fromEntries(node.guests.map((x) => [x.name, x]))
    assert.equal(g.db.expected, true, 'onboot=1 stopped guest should alarm')
    assert.equal(g.scratch.expected, false, 'onboot unset → not expected')
    assert.equal(g.web.netIn, 0, 'first sample has no rate')

    assert.deepEqual(node.disks.map((d) => d.health), ['ok', 'fail'], 'usb skipped, FAILED → fail')

    assert.equal(nas.kind, 'storage')
    assert.equal(nas.name, 'nas')
    assert.deepEqual(nas.capacity, { used: 2e12, total: 8e12 })
    assert.equal(s1.nodes.length, 2, 'local (non-shared) storage is not an appliance')

    assert.equal(s1.network[0].ports.length, 2)

    await new Promise((r) => setTimeout(r, 600))
    const s2 = await snapshot()
    const web = s2.nodes[0].guests.find((x) => x.name === 'web')
    assert.ok(web.netIn > 0 && web.netOut > 0, 'second sample yields rates')
    assert.ok(Math.abs(web.netIn / web.netOut - 2) < 0.01)
  } finally {
    pve.server.close()
  }
})

test('rejects on API errors', async () => {
  const server = http.createServer((_, res) => res.writeHead(401).end())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const snapshot = createProxmoxSource({ url: `http://127.0.0.1:${server.address().port}`, token: 'bad' })
    await assert.rejects(snapshot(), /HTTP 401/)
  } finally {
    server.close()
  }
})
