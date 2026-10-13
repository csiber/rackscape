import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { AISLE, RACK_D, type RackLayout, trayY } from './layout'
import { CEILING } from './Room'
import { COL, M } from './materials'
import { activity, lookup } from '../data/lookup'
import { snap } from '../store'

// Uplinks from every rack to the network rack, plus the WAN line through the
// ceiling. Glowing packets ride the cables: cyan = towards the rack
// (download), amber = away from it (upload). Density and speed follow traffic.

const SLOTS = 14

interface Cable {
  curve: THREE.CatmullRomCurve3
  length: number
  rate: () => [number, number] // [towards end, towards start]
}

function toWorld(r: RackLayout, x: number, y: number, z: number) {
  const c = Math.cos(r.rotationY)
  const s = Math.sin(r.rotationY)
  return new THREE.Vector3(r.position[0] + x * c + z * s, y, r.position[2] - x * s + z * c)
}

const trayZ = (r: RackLayout) => (r.rotationY === 0 ? -0.25 : RACK_D + AISLE * 2 + 0.25)

function buildCables(racks: RackLayout[]): Cable[] {
  const net = racks.find((r) => r.id === 'net')
  if (!net) return []
  const cables: Cable[] = []
  const TRAY_Y = trayY(racks)
  const RACK_H = net.height
  const nodes = racks.filter((r) => r.nodeIds.length)
  nodes.forEach((r, i) => {
    const off = (i - (nodes.length - 1) / 2) * 0.03
    const a = toWorld(r, 0.1, RACK_H, -0.3)
    const b = toWorld(net, -0.1 + off, RACK_H, -0.3)
    const tz = trayZ(r) + off
    const nz = trayZ(net) + off
    const pts = [a, new THREE.Vector3(a.x, TRAY_Y - 0.05, a.z), new THREE.Vector3(a.x, TRAY_Y + 0.01, tz)]
    if (tz !== nz) pts.push(new THREE.Vector3(a.x, TRAY_Y + 0.25, (tz + nz) / 2))
    const steps = Math.max(1, Math.ceil(Math.abs(b.x - a.x) / 0.4))
    for (let k = 1; k < steps; k++) pts.push(new THREE.Vector3(a.x + ((b.x - a.x) * k) / steps, TRAY_Y + 0.01, nz))
    pts.push(new THREE.Vector3(b.x, TRAY_Y + 0.01, nz), new THREE.Vector3(b.x, TRAY_Y - 0.05, b.z), b)
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.08)
    const ids = r.nodeIds
    cables.push({
      curve,
      length: curve.getLength(),
      rate: () => {
        const L = lookup(snap())
        let up = 0
        let down = 0
        for (const id of ids) {
          const n = L.nodes.get(id)
          if (n) (up += n.netOut), (down += n.netIn)
        }
        return [up, down] // a→b is upload, b→a download
      },
    })
  })
  // WAN through the ceiling
  const w0 = toWorld(net, 0.18, RACK_H, -0.2)
  const wan = new THREE.CatmullRomCurve3([w0, new THREE.Vector3(w0.x, TRAY_Y, w0.z - 0.05), new THREE.Vector3(w0.x, CEILING + 0.2, w0.z - 0.1)], false, 'catmullrom', 0.1)
  cables.push({
    curve: wan,
    length: wan.getLength(),
    rate: () => {
      const r = snap()?.network.find((d) => d.kind === 'router')
      return [r?.wanOut ?? 0, r?.wanIn ?? 0]
    },
  })
  return cables
}

const packetGeom = new THREE.SphereGeometry(0.012, 10, 8)
const packetMat = new THREE.MeshBasicMaterial({ toneMapped: false })
const m4 = new THREE.Matrix4()
const v = new THREE.Vector3()
const zero = new THREE.Matrix4().makeScale(0, 0, 0)
const up = COL.warm.clone().multiplyScalar(3)
const down = COL.ok.clone().multiplyScalar(3.2)

export function Cables({ racks }: { racks: RackLayout[] }) {
  const cables = useMemo(() => buildCables(racks), [racks])
  const tubes = useMemo(() => cables.map((c) => new THREE.TubeGeometry(c.curve, 96, 0.008, 6, false)), [cables])
  const count = cables.length * SLOTS * 2
  const phase = useMemo(() => Float32Array.from({ length: count }, () => Math.random()), [count])
  const ref = useRef<THREE.InstancedMesh>(null!)

  useLayoutEffect(() => {
    for (let i = 0; i < count; i++) {
      ref.current.setMatrixAt(i, zero)
      ref.current.setColorAt(i, i % (SLOTS * 2) < SLOTS ? up : down)
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.instanceColor!.needsUpdate = true
  }, [count])

  useFrame((_, dt) => {
    if (!ref.current) return
    cables.forEach((c, ci) => {
      const rates = c.rate()
      for (let dir = 0; dir < 2; dir++) {
        const a = activity(rates[dir])
        const active = Math.round(a * SLOTS)
        const speed = (0.35 + a * 1.4) / c.length
        for (let s = 0; s < SLOTS; s++) {
          const i = ci * SLOTS * 2 + dir * SLOTS + s
          phase[i] = (phase[i] + dt * speed) % 1
          if (s >= active) {
            ref.current.setMatrixAt(i, zero)
            continue
          }
          c.curve.getPointAt(dir === 0 ? phase[i] : 1 - phase[i], v)
          ref.current.setMatrixAt(i, m4.makeTranslation(v.x, v.y, v.z))
        }
      }
    })
    ref.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {tubes.map((g, i) => (
        <mesh key={i} geometry={g} material={M.cable} />
      ))}
      <instancedMesh ref={ref} args={[packetGeom, packetMat, count]} frustumCulled={false} />
    </group>
  )
}
