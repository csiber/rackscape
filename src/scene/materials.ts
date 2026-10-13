import * as THREE from 'three'

export const FONT = import.meta.env.BASE_URL + 'fonts/JetBrainsMono-Medium.ttf'

export const box = new THREE.BoxGeometry(1, 1, 1)

const std = (color: string, metalness = 0.6, roughness = 0.5) => new THREE.MeshStandardMaterial({ color, metalness, roughness })

export const M = {
  frame: std('#1b1e24', 0.8, 0.4),
  side: std('#0e1014', 0.7, 0.55),
  plinth: std('#08090b', 0.3, 0.8),
  back: std('#050607', 0.2, 0.9),
  wall: new THREE.MeshBasicMaterial({ color: '#040507' }),
  rail: std('#3a3f48', 0.9, 0.3),
  blank: std('#17191e', 0.5, 0.55),
  guest: std('#262a33', 0.45, 0.45),
  qemu: std('#2b2e39', 0.45, 0.45),
  host: std('#363b46', 0.6, 0.35),
  handle: std('#8b93a1', 1, 0.25),
  disks: std('#1e2127', 0.5, 0.45),
  bay: std('#0b0c0f', 0.5, 0.6),
  caddy: std('#3b414c', 0.9, 0.3),
  switch: std('#20242b', 0.45, 0.45),
  port: std('#020203', 0.1, 0.9),
  patch: std('#101216', 0.6, 0.5),
  ups: std('#16171b', 0.6, 0.55),
  track: new THREE.MeshBasicMaterial({ color: '#0a0c10' }),
  lcd: new THREE.MeshBasicMaterial({ color: new THREE.Color('#0c4a5e').multiplyScalar(1.4), toneMapped: false }),
  stripeLxc: new THREE.MeshBasicMaterial({ color: new THREE.Color('#2fd4ff').multiplyScalar(0.9), toneMapped: false }),
  stripeQemu: new THREE.MeshBasicMaterial({ color: new THREE.Color('#a37bff').multiplyScalar(0.9), toneMapped: false }),
  cable: std('#2a3039', 0.2, 0.55),
  tray: std('#3d434d', 0.35, 0.45),
}

export const PATCH_COLORS = ['#2b6cb0', '#d69e2e', '#4a5568', '#2b6cb0', '#38a169', '#4a5568', '#c53030', '#2b6cb0']
  .map((c) => std(c, 0.1, 0.6))

let glowTex: THREE.Texture | null = null
/** soft radial gradient used for fake light pools on the floor */
export function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

/** deterministic 0..1 hash for LED flicker */
export const rnd = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export const COL = {
  ok: new THREE.Color(0.15, 0.62, 1.0),
  warm: new THREE.Color(1.0, 0.55, 0.12),
  alarm: new THREE.Color(1.0, 0.08, 0.06),
  green: new THREE.Color(0.25, 1.0, 0.45),
  amber: new THREE.Color(1.0, 0.62, 0.1),
  blue: new THREE.Color(0.3, 0.6, 1.0),
  white: new THREE.Color(0.85, 0.92, 1.0),
  off: new THREE.Color(0.02, 0.02, 0.025),
}
