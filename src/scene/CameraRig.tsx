import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import { AISLE, RACK_D, type RackLayout, rowExtent } from './layout'
import { lookup } from '../data/lookup'
import { snap, useStore } from '../store'

// Cinematic autopilot: a sequence of "shots" (dolly, slider, crane, push-in,
// orbit) cut together with a dip to black. Any user input hands control to
// OrbitControls; after a while idle the autopilot takes over again.

/** DOM hooks the rig drives directly, without React re-renders */
export const overlay = { fade: null as HTMLDivElement | null, caption: null as HTMLDivElement | null }

interface Shot {
  name: string
  dur: number
  fov: number
  caption: string
  /** p: eased 0..1 progress; writes camera position + look target */
  at: (p: number, pos: THREE.Vector3, look: THREE.Vector3) => void
}

const ease = (p: number) => p * p * (3 - 2 * p)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const IDLE_RESUME = 40 // s

// ?shot=<name>&p=<0..1> freezes the autopilot on one frame (screenshots, tests)
const params = new URLSearchParams(location.search)
const FREEZE = params.get('shot')
const FREEZE_P = Number(params.get('p') ?? 0.5)

function rackCaption(r: RackLayout) {
  const ns = r.nodeIds.map((id) => lookup(snap()).nodes.get(id)).filter((n) => !!n)
  if (!ns.length) return 'network · core switching'
  if (ns.length > 1 || ns[0].kind === 'storage') return `storage · ${ns.map((n) => n.name).join(' · ')}`
  const n = ns[0]
  const run = n.guests.filter((g) => g.status === 'running').length
  return `${n.name} · ${run}/${n.guests.length} guests · ${Math.round(n.cpu * 100)}% cpu`
}

function busiest(racks: RackLayout[]) {
  const L = lookup(snap())
  return [...racks].sort((a, b) => (L.nodes.get(b.nodeIds[0] ?? '')?.cpu ?? -1) - (L.nodes.get(a.nodeIds[0] ?? '')?.cpu ?? -1))[0]
}

/** camera z in front of a rack, accounting for its facing */
const front = (r: RackLayout, d: number) => (r.rotationY === 0 ? r.position[2] + RACK_D / 2 + d : r.position[2] - RACK_D / 2 - d)

function makeShots(racks: RackLayout[], alarmRack: RackLayout | null): Shot[] {
  const { minX, maxX } = rowExtent(racks)
  const cx = (minX + maxX) / 2
  const span = maxX - minX
  const aisle = RACK_D / 2 + AISLE
  const pick = () => racks[Math.floor(Math.random() * racks.length)]

  if (alarmRack) {
    const r = alarmRack
    const x = r.position[0]
    return [
      {
        name: 'alarm',
        dur: 7,
        fov: 34,
        caption: `⚠ ${useStore.getState().alarms.find((a) => r.nodeIds.includes(a.nodeId))?.message ?? 'alarm'}`,
        at: (p, pos, look) => {
          pos.set(x + lerp(0.9, 0.35, p), r.focusY + lerp(0.5, 0.2, p), front(r, lerp(1.9, 1.05, p)))
          look.set(x, r.focusY, r.position[2])
        },
      },
    ]
  }

  const shots: Shot[] = [
    {
      name: 'establishing',
      dur: 11,
      fov: 42,
      caption: `${snap()?.cluster ?? 'homelab'} · ${racks.length} racks`,
      at: (p, pos, look) => {
        pos.set(lerp(maxX + 2.0, minX - 0.6, p), lerp(1.75, 1.25, p), aisle + 1.7)
        look.set(lerp(cx + span * 0.2, cx - span * 0.2, p), 0.75, 0)
      },
    },
    {
      name: 'slider',
      dur: 10,
      fov: 32,
      caption: 'rack fronts',
      at: (p, pos, look) => {
        const x = lerp(minX - 0.3, maxX + 0.3, p)
        pos.set(x, 0.55, RACK_D / 2 + 0.85)
        look.set(x + 0.7, 0.95, 0.1)
      },
    },
    (() => {
      const r = pick()
      const x = r.position[0]
      return {
        name: 'crane',
        dur: 10,
        fov: 38,
        caption: rackCaption(r),
        at: (p: number, pos: THREE.Vector3, look: THREE.Vector3) => {
          pos.set(x + 0.25, lerp(0.25, r.height + 0.35, p), front(r, lerp(1.0, 1.5, p)))
          look.set(x, lerp(0.4, r.height - 0.2, p), r.position[2])
        },
      }
    })(),
    (() => {
      const r = busiest(racks)
      const x = r.position[0]
      return {
        name: 'push-in',
        dur: 11,
        fov: 30,
        caption: rackCaption(r),
        at: (p: number, pos: THREE.Vector3, look: THREE.Vector3) => {
          pos.set(x + lerp(1.1, 0.22, p), r.focusY + lerp(0.45, 0.12, p), front(r, lerp(2.6, 0.75, p)))
          look.set(x, r.focusY, r.position[2])
        },
      }
    })(),
    {
      name: 'overhead',
      dur: 12,
      fov: 40,
      caption: 'uplinks · traffic',
      at: (p, pos, look) => {
        const a = lerp(-0.9, 0.9, p)
        const rad = span / 2 + 2.8
        pos.set(cx + Math.sin(a) * rad, 2.6, aisle + Math.cos(a) * rad * 0.6)
        look.set(cx, 0.9, 0)
      },
    },
    {
      name: 'floor',
      dur: 9,
      fov: 28,
      caption: 'cold aisle',
      at: (p, pos, look) => {
        pos.set(maxX + 1.0, 0.12, lerp(aisle + 0.3, aisle - 0.1, p))
        look.set(lerp(cx + 0.6, cx - 0.6, p), 0.75, RACK_D / 2)
      },
    },
  ]
  if (FREEZE) return shots.filter((x) => x.name === FREEZE)
  // shuffle all but the establishing shot so loops feel less canned
  const rest = shots.slice(1).sort(() => Math.random() - 0.5)
  return [shots[0], ...rest]
}

export function CameraRig({ racks }: { racks: RackLayout[] }) {
  const mode = useStore((s) => s.mode)
  const selected = useStore((s) => s.selected)
  const alarmIds = useStore((s) => s.alarms.map((a) => a.nodeId).join(','))
  const setMode = useStore((s) => s.setMode)
  const controls = useRef<OrbitImpl>(null!)
  const { camera, gl } = useThree()
  const cam = camera as THREE.PerspectiveCamera

  const state = useRef({ shots: [] as Shot[], i: 0, t: 0, idle: 0, look: new THREE.Vector3(0, 1, 0), seenAlarms: '', userMoved: false })
  const pos = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const shake = useMemo(() => new THREE.Vector3(), [])

  // user input → free camera; reset the idle timer
  useEffect(() => {
    const el = gl.domElement
    const onInput = () => {
      state.current.idle = 0
      if (useStore.getState().mode === 'cinematic') {
        controls.current?.target.copy(state.current.look)
        setMode('free')
      }
    }
    el.addEventListener('pointerdown', onInput)
    el.addEventListener('wheel', onInput, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onInput)
      el.removeEventListener('wheel', onInput)
    }
  }, [gl, setMode])

  // a new alarm interrupts the autopilot with a cut to the rack
  useEffect(() => {
    const s = state.current
    if (alarmIds && alarmIds !== s.seenAlarms && mode === 'cinematic' && !FREEZE) {
      const r = racks.find((x) => x.nodeIds.some((id) => alarmIds.split(',').includes(id)))
      if (r) {
        s.shots = [...makeShots(racks, r), ...makeShots(racks, null)]
        s.i = 0
        s.t = 0
      }
    }
    s.seenAlarms = alarmIds
  }, [alarmIds, mode, racks])

  useEffect(() => {
    state.current.shots = makeShots(racks, null)
    state.current.i = 0
    state.current.t = 0
  }, [racks])

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const s = state.current
    const fade = overlay.fade

    if (mode === 'cinematic') {
      if (!s.shots.length) s.shots = makeShots(racks, null)
      let shot = s.shots[s.i]
      s.t = FREEZE ? FREEZE_P * shot.dur : s.t + dt
      if (s.t > shot.dur) {
        s.t = 0
        s.i += 1
        if (s.i >= s.shots.length) {
          s.shots = makeShots(racks, null)
          s.i = 0
        }
        shot = s.shots[s.i]
      }
      if ((s.t < dt * 1.5 || FREEZE) && overlay.caption) overlay.caption.textContent = shot.caption
      shot.at(ease(s.t / shot.dur), pos, look)
      // subtle handheld drift
      const t = clock.elapsedTime
      shake.set(Math.sin(t * 0.7) * 0.012, Math.sin(t * 0.9 + 1) * 0.008, Math.sin(t * 0.5 + 2) * 0.01)
      cam.position.copy(pos).add(shake)
      s.look.copy(look)
      cam.lookAt(look)
      if (Math.abs(cam.fov - shot.fov) > 0.01) {
        cam.fov = shot.fov
        cam.updateProjectionMatrix()
      }
      if (fade && !FREEZE) {
        const edge = Math.min(s.t, shot.dur - s.t)
        fade.style.opacity = String(Math.max(0, 1 - edge / 0.45))
      }
      return
    }

    if (fade && fade.style.opacity !== '0') fade.style.opacity = '0'
    if (cam.fov !== 45) {
      cam.fov = lerp(cam.fov, 45, Math.min(1, dt * 3))
      if (Math.abs(cam.fov - 45) < 0.05) cam.fov = 45
      cam.updateProjectionMatrix()
    }

    if (mode === 'focus' && selected) {
      const r = racks.find((x) => x.id === selected)
      if (r && controls.current) {
        const x = r.position[0]
        const goal = new THREE.Vector3(x + 0.5, r.focusY + 0.3, front(r, 1.45))
        const target = new THREE.Vector3(x, r.focusY, r.position[2])
        const k = 1 - Math.exp(-dt * 3)
        if (cam.position.distanceTo(goal) > 0.02 || controls.current.target.distanceTo(target) > 0.02) {
          if (!s.userMoved) {
            cam.position.lerp(goal, k)
            controls.current.target.lerp(target, k)
          }
        }
      }
    }

    s.idle += dt
    if (s.idle > IDLE_RESUME) {
      s.idle = 0
      s.shots = makeShots(racks, null)
      s.i = 0
      s.t = 0
      setMode('cinematic')
    }
  })

  // when the user drags during a focus glide, stop the glide
  useEffect(() => {
    state.current.userMoved = false
  }, [selected])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={mode !== 'cinematic'}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.4}
      maxDistance={12}
      maxPolarAngle={Math.PI / 2 - 0.03}
      onStart={() => {
        state.current.userMoved = true
      }}
    />
  )
}
