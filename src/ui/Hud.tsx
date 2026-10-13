import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { overlay } from '../scene/CameraRig'
import { fmtBytes, fmtRate, lookup } from '../data/lookup'

function useTick(ms: number) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

function Stats() {
  useTick(1000)
  const s = useStore.getState().snap
  if (!s) return null
  const guests = s.nodes.flatMap((n) => n.guests)
  const running = guests.filter((g) => g.status === 'running').length
  const traffic = s.nodes.reduce((a, n) => a + n.netIn + n.netOut, 0)
  const hv = s.nodes.filter((n) => n.kind === 'hypervisor')
  const cpu = hv.reduce((a, n) => a + n.cpu, 0) / Math.max(1, hv.length)
  const stale = Date.now() - s.time > 15000
  return (
    <div className="stats">
      <div>
        <b>{hv.length}</b> {hv.length === 1 ? 'node' : 'nodes'}
      </div>
      <div>
        <b>
          {running}/{guests.length}
        </b>{' '}
        guests
      </div>
      <div>
        <b>{Math.round(cpu * 100)}%</b> cpu
      </div>
      <div>
        <b>{fmtRate(traffic)}</b>
      </div>
      {useStore.getState().source === 'demo' && <div className="pill">demo data</div>}
      {stale && <div className="pill warn">stale</div>}
    </div>
  )
}

function Alarms() {
  const alarms = useStore((s) => s.alarms)
  if (!alarms.length) return null
  return (
    <div className="alarms">
      {alarms.map((a) => (
        <div key={a.id} className="alarm">
          <span className="dot" /> {a.message}
        </div>
      ))}
    </div>
  )
}

function Details() {
  useTick(1000)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const s = useStore.getState().snap
  if (!selected || !s) return null
  const L = lookup(s)
  const n = L.nodes.get(selected)
  return (
    <aside className="details">
      <button className="close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      {n ? (
        <>
          <h2>{n.name}</h2>
          <div className="kv">
            <span>status</span>
            <b className={n.status === 'online' ? 'ok' : 'bad'}>{n.status}</b>
            <span>cpu</span>
            <b>
              {Math.round(n.cpu * 100)}% of {n.maxcpu}
            </b>
            <span>memory</span>
            <b>
              {fmtBytes(n.mem)} / {fmtBytes(n.maxmem)}
            </b>
            <span>network</span>
            <b>
              ↓ {fmtRate(n.netIn)} ↑ {fmtRate(n.netOut)}
            </b>
            {n.temp != null && (
              <>
                <span>temp</span>
                <b>{Math.round(n.temp)}°C</b>
              </>
            )}
            <span>uptime</span>
            <b>{Math.floor(n.uptime / 86400)}d</b>
          </div>
          {n.guests.length > 0 && (
            <ul className="guests">
              {n.guests.map((g) => (
                <li key={g.id} className={g.status === 'running' ? '' : 'down'}>
                  <span className="id">{g.vmid}</span>
                  <span className="name">
                    {g.name}
                    {g.type === 'qemu' && <em>vm</em>}
                  </span>
                  <span className="bar">
                    <i style={{ width: `${Math.round(g.cpu * 100)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {n.disks.length > 0 && (
            <div className="disks">
              {n.disks.map((d) => (
                <i key={d.id} className={d.health} title={`${d.label}: ${d.health}`} />
              ))}
            </div>
          )}
        </>
      ) : selected === 'storage' ? (
        <>
          <h2>storage</h2>
          {s.nodes
            .filter((x) => x.kind === 'storage')
            .map((x) => (
              <div key={x.id} className="kv">
                <span>{x.name}</span>
                <b className={x.status === 'online' ? '' : 'bad'}>
                  {x.capacity ? `${fmtBytes(x.capacity.used)} / ${fmtBytes(x.capacity.total)}` : x.status}
                </b>
              </div>
            ))}
        </>
      ) : (
        <>
          <h2>network</h2>
          {s.network.map((d) => (
            <div key={d.id} className="kv">
              <span>{d.kind}</span>
              <b>
                {d.name} · {d.ports.filter((p) => p.up).length}/{d.ports.length} ports up
              </b>
              {d.wanIn != null && (
                <>
                  <span>wan</span>
                  <b>
                    ↓ {fmtRate(d.wanIn)} ↑ {fmtRate(d.wanOut ?? 0)}
                  </b>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </aside>
  )
}

export function Hud() {
  const mode = useStore((s) => s.mode)
  const tv = useStore((s) => s.tv)
  const setMode = useStore((s) => s.setMode)
  const setTv = useStore((s) => s.setTv)
  const cinematic = mode === 'cinematic'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().select(null)
      if (e.key === 'c') setMode('cinematic')
      if (e.key === 'f') setMode('free')
      if (e.key === 't') setTv(!useStore.getState().tv)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setMode, setTv])

  const toggleTv = async () => {
    const next = !tv
    setTv(next)
    if (next) {
      setMode('cinematic')
      await document.documentElement.requestFullscreen?.().catch(() => {})
    } else if (document.fullscreenElement) await document.exitFullscreen()
  }

  return (
    <>
      <div ref={(el) => void (overlay.fade = el)} className="fade" />
      <div className={`letterbox ${cinematic ? 'on' : ''}`}>
        <div className="bar top" />
        <div className="bar bottom">
          <div ref={(el) => void (overlay.caption = el)} className="caption" />
        </div>
      </div>
      {!tv && (
        <>
          <header className="brand">
            <span className="logo">RACKSCAPE</span>
            <Stats />
          </header>
          <nav className="modes">
            <button className={cinematic ? 'on' : ''} onClick={() => setMode('cinematic')} title="Cinematic autopilot (C)">
              Cinematic
            </button>
            <button className={mode !== 'cinematic' ? 'on' : ''} onClick={() => setMode('free')} title="Free camera (F)">
              Explore
            </button>
            <button onClick={toggleTv} title="TV / wall display (T)">
              TV
            </button>
          </nav>
          <Details />
        </>
      )}
      {tv && (
        <button className="tv-exit" onClick={toggleTv} aria-label="Exit TV mode">
          exit
        </button>
      )}
      <Alarms />
    </>
  )
}
