# Rackscape

**A cinematic, live 3D server room for your homelab.**

Your Proxmox nodes become racks, every container and VM a rack unit with real LEDs. Traffic rides the cables as glowing packets, drive bays blink with I/O, and when a guest that should be running goes down, a red beacon spins up and the camera cuts to it.

Leave it in **TV mode** on a wall display and it keeps flying through your server room like the opening shot of a heist movie.

> **Status: early work in progress.** Demo mode and the Proxmox connector work; Docker image and network sources are next.

## Try it in 10 seconds

```sh
git clone https://github.com/csiber/rackscape && cd rackscape
npm install
npm run dev
```

No Proxmox needed: without a server it runs on a simulated homelab (with the occasional crash, so you can see alarms).

## Connect your Proxmox

Rackscape only **reads**. Create a dedicated user with the built-in `PVEAuditor` role and an API token (run on any Proxmox node):

```sh
pveum user add rackscape@pve --comment "Rackscape (read-only)"
pveum acl modify / --users rackscape@pve --roles PVEAuditor
pveum user token add rackscape@pve view --privsep 0
```

Then build and start the server (Node 18+, no other dependencies):

```sh
npm run build
PVE_URL=https://pve.lan:8006 \
PVE_TOKEN='rackscape@pve!view=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' \
PVE_INSECURE=1 \
npm run server
# → http://localhost:8080
```

| Variable | Default | |
|---|---|---|
| `PVE_URL` | — | Proxmox API base URL. Without it the UI runs in demo mode. |
| `PVE_TOKEN` | — | `user@realm!tokenid=secret` |
| `PVE_INSECURE` | off | `1` accepts Proxmox's self-signed certificate |
| `PVE_CA` | — | path to a CA certificate (better than `PVE_INSECURE`) |
| `CLUSTER_NAME` | cluster / node name | title shown in the UI |
| `BASIC_AUTH` | off | `user:password` to protect the page |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | |
| `CACHE_MS` | `2000` | one Proxmox poll is shared by all viewers |

The token stays on the server; browsers only receive the snapshot.

### Docker

```sh
docker build -t rackscape .
docker run -d -p 8080:8080 \
  -e PVE_URL=https://pve.lan:8006 -e PVE_TOKEN='rackscape@pve!view=…' -e PVE_INSECURE=1 \
  rackscape
```

## What you see

| In the room | Comes from |
|---|---|
| A rack per node, one rack unit per container (1U) or VM (2U) | `/cluster/resources` |
| Power LED: green / dark / **blinking red** | running / stopped / stopped but `onboot=1` |
| Activity LED, cable packets | network + disk I/O rates |
| Drive bays (amber = warning, red = failed) | `/nodes/<node>/disks/list` (SMART) |
| Storage rack with capacity bars | shared storage (NFS, CIFS, PBS, Ceph…) |
| Rack edge lights: blue → amber with load, red on alarm | node CPU / alarms |

## Controls

| Key | |
|---|---|
| `C` | cinematic autopilot |
| `F` | free camera (drag, scroll) |
| `T` | TV mode: no UI, for wall displays |
| click a rack | focus + details |
| `Esc` | close details |

Any input hands over to the free camera; after 40 s idle the autopilot takes back over.

## Status

- [x] Demo data source (simulated cluster, random crashes → alarms)
- [x] Racks sized from your data, LEDs driven by real activity
- [x] Uplink cables with traffic packets, WAN line
- [x] Cinematic camera: establishing / slider / crane / push-in / overhead / floor shots, alarm cut-ins
- [x] Free camera, rack focus + details panel, TV mode
- [x] Proxmox connector (read-only token, shared storage, SMART, onboot-aware alarms)
- [ ] Docker image published (the Dockerfile is there, not yet tested in CI)
- [ ] Network sources: UniFi, generic SNMP (real switch ports and WAN)
- [ ] Node temperatures (via a tiny agent or Prometheus)
- [ ] Ambient sound (fan hum follows load)
- [ ] Large nodes: guests overflow into a second rack

## Development

```sh
npm run dev      # UI with hot reload; /api is proxied to :8080 if the server runs
npm run server   # API + static server
npm test         # connector tests against a fake Proxmox API
```

`?shot=crane&p=0.5` freezes the autopilot on one frame (handy for screenshots); `?source=demo` forces demo data.

## License

MIT. Font: JetBrains Mono (SIL OFL 1.1, see `public/fonts/OFL.txt`).
