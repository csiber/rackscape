# Contributing to Rackscape

Thanks for wanting to make the server room better!

## Setup

```sh
npm ci
npm run dev      # http://localhost:5173, demo homelab with hot reload
npm test         # Proxmox connector tests (fake API, no cluster needed)
npm run build    # type-check + production bundle
```

To develop against a real cluster, run the server next to Vite; `/api` is proxied to it:

```sh
PVE_URL=https://pve.lan:8006 PVE_TOKEN='…' PVE_INSECURE=1 npm run server
```

## Where things live

| Path | What |
|---|---|
| `src/data/` | snapshot types, demo generator, data source selection |
| `src/scene/layout.ts` | snapshot → racks and rack units (pure, no three.js) |
| `src/scene/Rack.tsx` | cabinets, units, LEDs (one instanced mesh per rack) |
| `src/scene/Cables.tsx` | uplinks and traffic packets |
| `src/scene/CameraRig.tsx` | cinematic shots, free camera, focus |
| `src/scene/Room.tsx` | floor, lights, walls, cable trays |
| `src/ui/Hud.tsx` | overlay UI |
| `server/` | zero-dependency Node server and the Proxmox connector |

## Guidelines

- **Every visual must come from data.** No decoration that pretends to be status.
- **Keep the server dependency-free.** It runs on tiny LXCs and Raspberry Pis.
- **Read-only, always.** Rackscape never changes anything on the cluster.
- **Performance:** instance repeated meshes, update in `useFrame` through refs, and don't re-render React per frame.
- Visual changes: attach a screenshot or a short clip. `?source=demo&shot=crane&p=0.5` freezes the camera for reproducible screenshots.

## Adding a data source

Produce the `Snapshot` described in [`src/data/types.ts`](src/data/types.ts) (see the wiki page *Snapshot format*), and serve it at `/api/snapshot`. `server/proxmox.mjs` is the reference implementation.
