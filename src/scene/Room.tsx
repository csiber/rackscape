import { useMemo } from 'react'
import * as THREE from 'three'
import { Environment, Lightformer, MeshReflectorMaterial, SpotLight } from '@react-three/drei'
import { AISLE, RACK_D, type RackLayout, rowExtent, trayY } from './layout'
import { M, box } from './materials'

export const CEILING = 3.2

/** raised-floor tile grid, with perforated tiles along the cold aisle */
function tileTexture(perforated: boolean) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 256, 256)
  g.strokeStyle = 'rgba(120,140,170,0.07)'
  g.lineWidth = 3
  g.strokeRect(1, 1, 254, 254)
  if (perforated) {
    g.fillStyle = 'rgba(0,0,0,0.55)'
    for (let y = 24; y < 240; y += 14) for (let x = 24; x < 240; x += 14) g.fillRect(x, y, 6, 6)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const TILE = 0.6

export function Room({ racks }: { racks: RackLayout[] }) {
  const { minX, maxX, rows } = rowExtent(racks)
  const x0 = minX - 3.5
  const x1 = maxX + 3.5
  const z0 = -RACK_D / 2 - 1.6
  const z1 = rows === 2 ? RACK_D + AISLE * 2 + RACK_D / 2 + 1.6 : RACK_D / 2 + AISLE * 2 + 2.5
  const w = x1 - x0
  const d = z1 - z0
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const aisleZ = RACK_D / 2 + AISLE
  const ty = trayY(racks)

  const grid = useMemo(() => {
    const t = tileTexture(false)
    t.repeat.set(w / TILE, d / TILE)
    return t
  }, [w, d])
  const perf = useMemo(() => {
    const t = tileTexture(true)
    t.repeat.set((maxX - minX + 1.2) / TILE, 2)
    return t
  }, [minX, maxX])

  const lights = useMemo(() => {
    const xs: number[] = []
    for (let x = minX - 0.6; x <= maxX + 0.61; x += 1.8) xs.push(x)
    return xs
  }, [minX, maxX])

  return (
    <group>
      <fog attach="fog" args={['#030407', 6, 19]} />
      <color attach="background" args={['#030406']} />
      <hemisphereLight args={['#5b7bb0', '#050506', 0.3]} />
      {/* soft fill from the aisle so rack fronts read */}
      <directionalLight position={[1.5, 2.2, 6]} intensity={0.35} color="#9db8e0" />

      {/* reflective raised floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]}>
        <planeGeometry args={[w, d]} />
        <MeshReflectorMaterial
          blur={[400, 120]}
          resolution={1024}
          mixBlur={1}
          mixStrength={28}
          roughness={0.85}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#06070a"
          metalness={0.8}
          mirror={0.6}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.001, cz]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={grid} transparent depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(minX + maxX) / 2, 0.0015, aisleZ]}>
        <planeGeometry args={[maxX - minX + 1.2, TILE * 2]} />
        <meshBasicMaterial map={perf} transparent depthWrite={false} />
      </mesh>

      {/* walls + ceiling */}
      <mesh geometry={box} material={M.wall} position={[cx, CEILING / 2, z0]} scale={[w, CEILING, 0.1]} />
      <mesh geometry={box} material={M.wall} position={[cx, CEILING / 2, z1]} scale={[w, CEILING, 0.1]} />
      <mesh geometry={box} material={M.wall} position={[x0, CEILING / 2, cz]} scale={[0.1, CEILING, d]} />
      <mesh geometry={box} material={M.wall} position={[x1, CEILING / 2, cz]} scale={[0.1, CEILING, d]} />
      <mesh geometry={box} material={M.wall} position={[cx, CEILING, cz]} scale={[w, 0.05, d]} />

      {/* linear ceiling luminaires + volumetric cones over the aisle */}
      {lights.map((x, i) => (
        <group key={i}>
          <mesh geometry={box} position={[x, CEILING - 0.04, aisleZ]} scale={[1.2, 0.02, 0.08]}>
            <meshBasicMaterial color={new THREE.Color('#cfe3ff').multiplyScalar(2.2)} toneMapped={false} />
          </mesh>
          <SpotLight
            position={[x, CEILING - 0.06, aisleZ]}
            target-position={[x, 0, aisleZ - 0.4]}
            angle={0.6}
            penumbra={0.8}
            distance={6}
            attenuation={4.5}
            anglePower={4}
            intensity={45}
            opacity={0.06}
            color="#bcd6ff"
            volumetric
          />
        </group>
      ))}

      <Tray x0={minX - 0.2} x1={maxX + 0.2} z={-0.25} y={ty} />
      {rows === 2 && <Tray x0={minX - 0.2} x1={maxX + 0.2} z={RACK_D + AISLE * 2 + 0.25} y={ty} />}

      {/* image-based lighting for metal surfaces, built from light cards — no HDR download */}
      <Environment resolution={256} frames={1} environmentIntensity={0.7}>
        <Lightformer form="rect" intensity={2.5} color="#9cc4ff" position={[0, 3, 1.5]} rotation-x={Math.PI / 2} scale={[8, 0.4, 1]} />
        <Lightformer form="rect" intensity={1.4} color="#9cc4ff" position={[0, 3, -1]} rotation-x={Math.PI / 2} scale={[8, 0.3, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#ffb070" position={[-5, 1, 2]} rotation-y={Math.PI / 2} scale={[4, 1, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#5aa0ff" position={[5, 1, 2]} rotation-y={-Math.PI / 2} scale={[4, 1, 1]} />
      </Environment>
    </group>
  )
}

/** ladder-style cable tray hanging above the racks */
function Tray({ x0, x1, z, y: TRAY_Y }: { x0: number; x1: number; z: number; y: number }) {
  const len = x1 - x0
  const rungs = Math.floor(len / 0.3)
  return (
    <group position={[(x0 + x1) / 2, TRAY_Y, z]}>
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={box} material={M.tray} position={[0, 0, s * 0.15]} scale={[len, 0.05, 0.012]} />
      ))}
      {Array.from({ length: rungs }, (_, i) => (
        <mesh key={i} geometry={box} material={M.tray} position={[-len / 2 + (i + 0.5) * (len / rungs), -0.022, 0]} scale={[0.02, 0.008, 0.3]} />
      ))}
      {[x0 + 0.1, x1 - 0.1].map((x, i) => (
        <mesh key={`h${i}`} geometry={box} material={M.tray} position={[x - (x0 + x1) / 2, (CEILING - TRAY_Y) / 2, 0]} scale={[0.01, CEILING - TRAY_Y, 0.01]} />
      ))}
    </group>
  )
}
