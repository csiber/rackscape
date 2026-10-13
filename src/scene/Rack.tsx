import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { INNER_W, PLINTH, RACK_D, RACK_W, U, unitY, type RackLayout, type RackUnit } from './layout'
import { COL, FONT, M, PATCH_COLORS, box, glowTexture, rnd } from './materials'
import { activity, lookup } from '../data/lookup'
import { snap, useStore } from '../store'

const FZ = RACK_D / 2 - 0.03 // unit front plane
const LX = -INNER_W / 2 + 0.018 // first LED column

// ---------------------------------------------------------------- LEDs

type LedKind = 'power' | 'act' | 'nic' | 'health' | 'disk' | 'port' | 'wan' | 'ups'
interface Led {
  p: [number, number, number]
  kind: LedKind
  ref: string
  i: number
}

function buildLeds(rack: RackLayout): Led[] {
  const s = snap()
  const L = lookup(s)
  const out: Led[] = []
  const z = FZ + 0.002
  for (const u of rack.units) {
    const y = unitY(u.u, u.h)
    const top = PLINTH + (u.u + u.h) * U
    if (u.kind === 'guest') {
      out.push({ p: [LX, y, z], kind: 'power', ref: u.ref!, i: 0 })
      out.push({ p: [LX + 0.011, y, z], kind: 'act', ref: u.ref!, i: 1 })
    } else if (u.kind === 'host') {
      out.push({ p: [LX, top - 0.015, z], kind: 'power', ref: u.ref!, i: 0 })
      out.push({ p: [LX, top - 0.03, z], kind: 'nic', ref: u.ref!, i: 0 })
      out.push({ p: [LX, top - 0.045, z], kind: 'nic', ref: u.ref!, i: 1 })
      out.push({ p: [LX, top - 0.06, z], kind: 'health', ref: u.ref!, i: 0 })
    } else if (u.kind === 'disks') {
      const n = L.nodes.get(u.ref!)?.disks.length ?? 0
      const bw = (INNER_W - 0.04) / 4
      for (let i = 0; i < n; i++) {
        const col = i % 4
        const row = Math.floor(i / 4)
        const by = PLINTH + (u.u + row + 0.5) * U
        out.push({ p: [-INNER_W / 2 + 0.02 + bw * (col + 1) - 0.012, by - U * 0.3, z + 0.003], kind: 'disk', ref: u.ref!, i })
      }
    } else if (u.kind === 'switch' || u.kind === 'router') {
      const n = L.net.get(u.ref!)?.ports.length ?? 0
      portPositions(u, n).forEach(([x, py, up], i) => out.push({ p: [x, py + (up ? 0.0085 : -0.0085), z], kind: 'port', ref: u.ref!, i }))
      if (u.kind === 'router') out.push({ p: [LX, y, z], kind: 'wan', ref: u.ref!, i: 0 })
    } else if (u.kind === 'ups') {
      for (let i = 0; i < 3; i++) out.push({ p: [0.12 + i * 0.014, y, z], kind: 'ups', ref: u.id, i })
    }
  }
  return out
}

/** [x, y, isTopRow] for each port, 12 per row, grouped in sixes */
function portPositions(u: RackUnit, n: number): [number, number, boolean][] {
  const res: [number, number, boolean][] = []
  const perRow = u.kind === 'router' ? 8 : 12
  for (let i = 0; i < n; i++) {
    const row = u.kind === 'router' ? 0 : i % 2
    const col = u.kind === 'router' ? i : Math.floor(i / 2) % perRow
    const uu = u.kind === 'router' ? 0 : Math.floor(i / 24)
    const x = -0.04 + col * 0.0175 + Math.floor(col / 6) * 0.012
    const y = PLINTH + (u.u + uu + 0.5) * U + (u.kind === 'router' ? 0 : row === 0 ? 0.008 : -0.008)
    res.push([x, y, row === 0])
  }
  return res
}

const ledGeom = new THREE.BoxGeometry(0.0045, 0.0028, 0.002)
const ledMat = new THREE.MeshBasicMaterial({ toneMapped: false })
const tmp = new THREE.Color()
const m4 = new THREE.Matrix4()

function LedField({ leds }: { leds: Led[] }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    leds.forEach((l, i) => {
      ref.current.setMatrixAt(i, m4.makeTranslation(...l.p))
      ref.current.setColorAt(i, COL.off)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [leds])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const s = snap()
    if (!s || !ref.current.instanceColor) return
    const L = lookup(s)
    leds.forEach((l, i) => {
      ledColor(l, i, t, L)
      ref.current.setColorAt(i, tmp)
    })
    ref.current.instanceColor.needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[ledGeom, ledMat, leds.length]} frustumCulled={false} />
}

const flick = (t: number, i: number, a: number) => rnd(Math.floor(t * (6 + a * 26)), i) < 0.12 + a * 0.75

function ledColor(l: Led, i: number, t: number, L: ReturnType<typeof lookup>) {
  tmp.copy(COL.off)
  switch (l.kind) {
    case 'power': {
      const g = L.guests.get(l.ref)
      if (g) {
        if (g.status === 'running') tmp.copy(COL.green).multiplyScalar(1.4)
        else if (g.expected) Math.sin(t * 7) > 0 && tmp.copy(COL.alarm).multiplyScalar(4)
        return
      }
      const n = L.nodes.get(l.ref)
      if (n) tmp.copy(n.status === 'online' ? COL.green : COL.alarm).multiplyScalar(1.6)
      return
    }
    case 'act': {
      const g = L.guests.get(l.ref)
      if (!g || g.status !== 'running') return
      const a = activity(g.netIn + g.netOut + g.diskRead + g.diskWrite)
      if (flick(t, i + l.ref.length * 31, a)) tmp.copy(COL.amber).multiplyScalar(2.6)
      return
    }
    case 'nic': {
      const n = L.nodes.get(l.ref)
      if (!n) return
      const a = activity(l.i === 0 ? n.netIn : n.netOut)
      if (flick(t, i * 7 + l.i, a)) tmp.copy(COL.green).multiplyScalar(2.2)
      return
    }
    case 'health': {
      const n = L.nodes.get(l.ref)
      if (!n) return
      if (n.status !== 'online') tmp.copy(COL.alarm).multiplyScalar(3)
      else if ((n.temp ?? 0) > 80) tmp.copy(COL.amber).multiplyScalar(2.5)
      else tmp.copy(COL.blue).multiplyScalar(1.6 + Math.sin(t * 1.5) * 0.4)
      return
    }
    case 'disk': {
      const d = L.nodes.get(l.ref)?.disks[l.i]
      if (!d) return
      if (d.health === 'fail') Math.sin(t * 6) > 0 && tmp.copy(COL.alarm).multiplyScalar(4)
      else if (d.health === 'warn') tmp.copy(COL.amber).multiplyScalar(2)
      else if (flick(t, i * 13 + 5, d.busy)) tmp.copy(COL.white).multiplyScalar(2.4)
      else tmp.copy(COL.blue).multiplyScalar(0.5)
      return
    }
    case 'port': {
      const p = L.net.get(l.ref)?.ports[l.i]
      if (!p || !p.up) return
      if (flick(t, i * 17 + 3, activity(p.rate))) tmp.copy(COL.green).multiplyScalar(2.2)
      else tmp.copy(COL.green).multiplyScalar(0.35)
      return
    }
    case 'wan': {
      const r = L.net.get(l.ref)
      if (r && flick(t, 99, activity((r.wanIn ?? 0) + (r.wanOut ?? 0)))) tmp.copy(COL.ok).multiplyScalar(3)
      return
    }
    case 'ups':
      tmp.copy(COL.green).multiplyScalar(l.i === 2 ? 0.8 + Math.sin(t * 0.8) * 0.6 : 1.3)
      return
  }
}

// ---------------------------------------------------------------- units

function Chassis({ u, mat, depth = 0.7 }: { u: RackUnit; mat: THREE.Material; depth?: number }) {
  const h = u.h * U - 0.0012
  return <mesh geometry={box} material={mat} position={[0, unitY(u.u, u.h), FZ - depth / 2]} scale={[INNER_W, h, depth]} />
}

function Bar({ y, x0, w, get }: { y: number; x0: number; w: number; get: () => number }) {
  const ref = useRef<THREE.Mesh>(null!)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  useFrame((_, dt) => {
    const v = Math.max(0.001, get())
    const cur = ref.current.scale.x
    const next = cur + (v * w - cur) * Math.min(1, dt * 4)
    ref.current.scale.x = Math.max(0.0005, next)
    ref.current.position.x = x0 + ref.current.scale.x / 2
    tmp.copy(COL.ok).lerp(v > 0.75 ? COL.alarm : COL.warm, Math.min(1, v * 1.2)).multiplyScalar(1.6)
    mat.color.copy(tmp)
  })
  return (
    <>
      <mesh geometry={box} material={M.track} position={[x0 + w / 2, y, FZ + 0.0006]} scale={[w, 0.0042, 0.001]} />
      <mesh ref={ref} geometry={box} material={mat} position={[x0, y, FZ + 0.0012]} scale={[0.001, 0.0034, 0.001]} />
    </>
  )
}

function Label({ text, x, y, size = 0.0115, color = '#8f9aab' }: { text: string; x: number; y: number; size?: number; color?: string }) {
  return (
    <Text font={FONT} fontSize={size} color={color} anchorX="left" anchorY="middle" position={[x, y, FZ + 0.0015]} letterSpacing={0.02}>
      {text}
    </Text>
  )
}

function GuestUnit({ u }: { u: RackUnit }) {
  const y = unitY(u.u, u.h)
  const g = lookup(snap()).guests.get(u.ref!)
  const qemu = g?.type === 'qemu'
  const get = (k: 'cpu' | 'mem') => () => {
    const x = lookup(snap()).guests.get(u.ref!)
    if (!x || x.status !== 'running') return 0
    return k === 'cpu' ? x.cpu : x.mem / Math.max(1, x.maxmem)
  }
  return (
    <group>
      <Chassis u={u} mat={qemu ? M.qemu : M.guest} />
      <mesh geometry={box} material={qemu ? M.stripeQemu : M.stripeLxc} position={[-INNER_W / 2 + 0.004, y, FZ + 0.0008]} scale={[0.0025, u.h * U * 0.62, 0.001]} />
      <Label text={u.label} x={LX + 0.026} y={qemu ? y + 0.008 : y} />
      {qemu && <Label text="VM" x={LX + 0.026} y={y - 0.012} size={0.009} color="#a37bff" />}
      <Bar y={qemu ? y + 0.008 : y} x0={0.1} w={0.125} get={get('cpu')} />
      {qemu && <Bar y={y - 0.012} x0={0.1} w={0.125} get={get('mem')} />}
    </group>
  )
}

function HostUnit({ u }: { u: RackUnit }) {
  const y = unitY(u.u, u.h)
  const node = () => lookup(snap()).nodes.get(u.ref!)
  const appliance = !!node()?.capacity
  const get = (k: 'cpu' | 'mem' | 'used') => () => {
    const n = node()
    if (!n) return 0
    if (k === 'used') return n.capacity ? n.capacity.used / Math.max(1, n.capacity.total) : 0
    return k === 'cpu' ? n.cpu : n.mem / Math.max(1, n.maxmem)
  }
  return (
    <group>
      <Chassis u={u} mat={M.host} depth={0.75} />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={box} material={M.handle} position={[s * (INNER_W / 2 - 0.006), y, FZ + 0.012]} scale={[0.006, u.h * U * 0.7, 0.02]} />
      ))}
      <Label text={u.label.toUpperCase()} x={LX + 0.02} y={y + 0.01} size={appliance ? 0.016 : 0.02} color="#d7e1ee" />
      {appliance ? (
        <>
          <Label text="USED" x={0.05} y={y + 0.012} size={0.008} />
          <Bar y={y + 0.012} x0={0.085} w={0.12} get={get('used')} />
        </>
      ) : (
        <>
          <Label text="CPU" x={0.055} y={y + 0.012} size={0.008} />
          <Label text="MEM" x={0.055} y={y - 0.006} size={0.008} />
          <Bar y={y + 0.012} x0={0.085} w={0.12} get={get('cpu')} />
          <Bar y={y - 0.006} x0={0.085} w={0.12} get={get('mem')} />
        </>
      )}
      {/* fan grille */}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} geometry={box} material={M.port} position={[-0.07 + i * 0.024, y - 0.02, FZ + 0.0008]} scale={[0.018, 0.012, 0.001]} />
      ))}
    </group>
  )
}

function DiskUnit({ u }: { u: RackUnit }) {
  const n = lookup(snap()).nodes.get(u.ref!)?.disks.length ?? 0
  const bw = (INNER_W - 0.04) / 4
  return (
    <group>
      <Chassis u={u} mat={M.disks} />
      {Array.from({ length: n }, (_, i) => {
        const col = i % 4
        const row = Math.floor(i / 4)
        const by = PLINTH + (u.u + row + 0.5) * U
        const bx = -INNER_W / 2 + 0.02 + bw * (col + 0.5)
        return (
          <group key={i}>
            <mesh geometry={box} material={M.bay} position={[bx, by, FZ + 0.0005]} scale={[bw - 0.006, U - 0.007, 0.001]} />
            <mesh geometry={box} material={M.caddy} position={[bx - 0.01, by + 0.006, FZ + 0.003]} scale={[bw - 0.04, 0.004, 0.004]} />
          </group>
        )
      })}
    </group>
  )
}

function NetUnit({ u }: { u: RackUnit }) {
  const n = lookup(snap()).net.get(u.ref!)?.ports.length ?? 0
  const y = unitY(u.u, u.h)
  return (
    <group>
      <Chassis u={u} mat={M.switch} depth={0.4} />
      <Label text={u.label} x={LX + 0.02} y={y} size={0.0105} />
      {portPositions(u, n).map(([x, py], i) => (
        <mesh key={i} geometry={box} material={M.port} position={[x, py, FZ + 0.0008]} scale={[0.0115, 0.0085, 0.001]} />
      ))}
    </group>
  )
}

function PatchUnit({ u }: { u: RackUnit }) {
  const y = unitY(u.u, u.h)
  const net = u.id.startsWith('net/')
  return (
    <group>
      <Chassis u={u} mat={M.patch} depth={0.12} />
      {Array.from({ length: 24 }, (_, i) => {
        const x = -0.2 + i * 0.0175
        const plugged = net && rnd(i, u.u) > 0.35
        return (
          <group key={i}>
            <mesh geometry={box} material={M.port} position={[x, y, FZ + 0.0008]} scale={[0.0105, 0.009, 0.001]} />
            {plugged && (
              <mesh geometry={box} material={PATCH_COLORS[(i + u.u) % PATCH_COLORS.length]} position={[x, y - 0.004, FZ + 0.03]} scale={[0.008, 0.007, 0.06]} rotation={[0.35, 0, 0]} />
            )}
          </group>
        )
      })}
    </group>
  )
}

function UpsUnit({ u }: { u: RackUnit }) {
  const y = unitY(u.u, u.h)
  return (
    <group>
      <Chassis u={u} mat={M.ups} />
      <mesh geometry={box} material={M.lcd} position={[0.02, y, FZ + 0.0008]} scale={[0.07, 0.03, 0.001]} />
      <Text font={FONT} fontSize={0.0085} color="#c9f3ff" anchorX="center" anchorY="middle" position={[0.02, y, FZ + 0.0016]}>
        {'ONLINE\nBATT 100%'}
      </Text>
      <Label text="UPS" x={LX} y={y} size={0.012} />
    </group>
  )
}

function UnitView({ u }: { u: RackUnit }) {
  switch (u.kind) {
    case 'guest':
      return <GuestUnit u={u} />
    case 'host':
      return <HostUnit u={u} />
    case 'disks':
      return <DiskUnit u={u} />
    case 'switch':
    case 'router':
      return <NetUnit u={u} />
    case 'patch':
      return <PatchUnit u={u} />
    case 'ups':
      return <UpsUnit u={u} />
    default:
      return <Chassis u={u} mat={M.blank} depth={0.02} />
  }
}

// ---------------------------------------------------------------- cabinet

function Cabinet({ h, size }: { h: number; size: number }) {
  const posts: [number, number][] = [
    [-RACK_W / 2 + 0.02, RACK_D / 2 - 0.02],
    [RACK_W / 2 - 0.02, RACK_D / 2 - 0.02],
    [-RACK_W / 2 + 0.02, -RACK_D / 2 + 0.02],
    [RACK_W / 2 - 0.02, -RACK_D / 2 + 0.02],
  ]
  return (
    <group>
      {posts.map(([x, z], i) => (
        <mesh key={i} geometry={box} material={M.frame} position={[x, h / 2, z]} scale={[0.04, h, 0.04]} />
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={box} material={M.side} position={[s * (RACK_W / 2 - 0.004), h / 2, 0]} scale={[0.008, h - 0.01, RACK_D - 0.04]} />
      ))}
      <mesh geometry={box} material={M.frame} position={[0, h - 0.02, 0]} scale={[RACK_W, 0.04, RACK_D]} />
      <mesh geometry={box} material={M.plinth} position={[0, PLINTH / 2, 0]} scale={[RACK_W - 0.01, PLINTH, RACK_D - 0.01]} />
      <mesh geometry={box} material={M.back} position={[0, h / 2, -RACK_D / 2 + 0.03]} scale={[RACK_W - 0.05, h - 0.1, 0.01]} />
      {[-1, 1].map((s) => (
        <mesh key={`r${s}`} geometry={box} material={M.rail} position={[s * (INNER_W / 2 + 0.01), PLINTH + (size * U) / 2, FZ - 0.004]} scale={[0.016, size * U, 0.006]} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- state lights

function useRackState(rack: RackLayout) {
  const alarm = useStore((s) => s.alarms.some((a) => rack.nodeIds.includes(a.nodeId)))
  return { alarm }
}

function rackLoad(rack: RackLayout) {
  const s = snap()
  if (!s) return 0
  if (rack.nodeIds.length) {
    const ns = rack.nodeIds.map((id) => lookup(s).nodes.get(id)).filter((n) => !!n)
    return Math.max(0, ...ns.map((n) => (n.capacity ? n.capacity.used / Math.max(1, n.capacity.total) : n.cpu)))
  }
  const sum = s.network.reduce((a, d) => a + d.ports.reduce((b, p) => b + p.rate, 0), 0)
  return activity(sum) * 0.8
}

function StateLights({ rack, hovered, selected }: { rack: RackLayout; hovered: boolean; selected: boolean }) {
  const { alarm } = useRackState(rack)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), [])
  const glow = useMemo(
    () => new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  const c = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const load = rackLoad(rack)
    if (alarm) c.copy(COL.alarm).multiplyScalar(1.5 + (Math.sin(t * 5) * 0.5 + 0.5) * 2.5)
    else c.copy(COL.ok).lerp(COL.warm, Math.min(1, load * 1.1)).multiplyScalar(0.9 + load * 1.2 + Math.sin(t * 0.9 + rack.position[0]) * 0.12)
    if (hovered || selected) c.multiplyScalar(1.8)
    mat.color.copy(c)
    glow.color.copy(c).multiplyScalar(alarm ? 0.35 : 0.16)
  })
  const fz = RACK_D / 2 + 0.002
  const RACK_H = rack.height
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={box} material={mat} position={[s * (RACK_W / 2 - 0.003), RACK_H / 2 + 0.04, fz]} scale={[0.004, RACK_H - 0.16, 0.004]} />
      ))}
      <mesh geometry={box} material={mat} position={[0, RACK_H - 0.004, fz]} scale={[RACK_W - 0.02, 0.004, 0.004]} />
      <mesh material={glow} position={[0, 0.003, RACK_D / 2 + 0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.3, 1.2]} />
      </mesh>
    </group>
  )
}

/** Rotating warning beacon: a glowing dome plus a red spot that sweeps the room. */
function Beacon({ rack }: { rack: RackLayout }) {
  const { alarm } = useRackState(rack)
  const spin = useRef<THREE.Group>(null!)
  const spot = useRef<THREE.SpotLight>(null!)
  const glow = useRef<THREE.PointLight>(null!)
  const target = useMemo(() => new THREE.Object3D(), [])
  useFrame(({ clock }, dt) => {
    if (!alarm) return
    spin.current.rotation.y += dt * 4.5
    glow.current.intensity = 1.2 + Math.sin(clock.elapsedTime * 9) * 0.6
  })
  useLayoutEffect(() => {
    if (spot.current) spot.current.target = target
  }, [alarm, target])
  if (!alarm) return null
  return (
    <group position={[RACK_W / 2 - 0.08, rack.height, RACK_D / 2 - 0.1]}>
      <mesh position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.03, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color={new THREE.Color(1, 0.1, 0.05).multiplyScalar(4)} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.034, 0.036, 0.012, 16]} />
        <meshStandardMaterial color="#1a1c21" metalness={0.6} roughness={0.5} />
      </mesh>
      <group ref={spin} position={[0, 0.04, 0]}>
        <primitive object={target} position={[2.5, -1.6, 0]} />
        <spotLight ref={spot} color="#ff2a18" intensity={40} angle={0.32} penumbra={0.6} distance={7} decay={1.5} />
      </group>
      <pointLight ref={glow} color="#ff2a18" distance={1.6} decay={2} position={[0, 0.08, 0]} />
    </group>
  )
}

function Sign({ title, h }: { title: string; h: number }) {
  return (
    <group position={[0, h - 0.065, RACK_D / 2 - 0.005]}>
      <mesh geometry={box} material={M.plinth} scale={[RACK_W - 0.08, 0.05, 0.004]} />
      <Text font={FONT} fontSize={0.028} color="#cfd9e6" anchorX="center" anchorY="middle" position={[0, 0, 0.003]} letterSpacing={0.18}>
        {title.toUpperCase()}
      </Text>
    </group>
  )
}

// ---------------------------------------------------------------- rack

export function Rack({ rack }: { rack: RackLayout }) {
  const leds = useMemo(() => buildLeds(rack), [rack])
  const [hovered, setHovered] = useState(false)
  const selected = useStore((s) => s.selected === rack.id)
  const select = useStore((s) => s.select)

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    select(rack.id)
  }

  return (
    <group
      position={rack.position}
      rotation={[0, rack.rotationY, 0]}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = ''
      }}
    >
      <Cabinet h={rack.height} size={rack.size} />
      {rack.units.map((u) => (
        <UnitView key={u.id} u={u} />
      ))}
      <LedField leds={leds} />
      <StateLights rack={rack} hovered={hovered} selected={selected} />
      <Sign title={rack.title} h={rack.height} />
      <Beacon rack={rack} />
    </group>
  )
}
