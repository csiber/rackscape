import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { computeLayout } from './layout'
import { Rack } from './Rack'
import { Room } from './Room'
import { Cables } from './Cables'
import { CameraRig } from './CameraRig'
import { snap, useStore } from '../store'

function World() {
  const key = useStore((s) => s.structureKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const racks = useMemo(() => (snap() ? computeLayout(snap()!) : []), [key])
  const select = useStore((s) => s.select)
  if (!racks.length) return null
  return (
    <group onPointerMissed={() => select(null)}>
      <Room racks={racks} />
      {racks.map((r) => (
        <Rack key={r.id} rack={r} />
      ))}
      <Cables racks={racks} />
      <CameraRig racks={racks} />
    </group>
  )
}

export function Scene() {
  const [hq, setHq] = useState(true)
  const ca = useMemo(() => new THREE.Vector2(0.0006, 0.0004), [])
  return (
    <Canvas
      dpr={hq ? [1, 1.75] : [0.75, 1]}
      camera={{ position: [4, 2, 5], fov: 42, near: 0.05, far: 60 }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping
      }}
    >
      <PerformanceMonitor onDecline={() => setHq(false)} onIncline={() => setHq(true)} />
      <AdaptiveDpr pixelated />
      <Suspense fallback={null}>
        <World />
      </Suspense>
      <EffectComposer multisampling={hq ? 4 : 0}>
        <Bloom mipmapBlur intensity={hq ? 1.1 : 0.8} luminanceThreshold={0.9} luminanceSmoothing={0.2} radius={0.75} />
        <ChromaticAberration offset={ca} radialModulation modulationOffset={0.4} />
        <Vignette offset={0.25} darkness={0.75} />
        <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.35} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Canvas>
  )
}
