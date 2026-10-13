# Rackscape

A cinematic, live 3D server room for your homelab. Your Proxmox nodes become racks, every container and VM a rack unit with real LEDs; traffic rides the cables, and when something goes down a beacon spins and the camera cuts to it.

> **Status: early work in progress.** Demo mode works; the Proxmox connector is next.

## Try it

```sh
npm install
npm run dev
```

It starts in **demo mode** with a simulated homelab — no Proxmox needed.

| Key | |
|---|---|
| `C` | cinematic autopilot |
| `F` | free camera (drag / scroll) |
| `T` | TV mode — no UI, for wall displays |
| click a rack | focus + details |

## Status

- [x] Demo data source (simulated cluster, random crashes → alarms)
- [x] Racks sized from your data, LEDs driven by real activity
- [x] Uplink cables with traffic packets, WAN line
- [x] Cinematic camera: establishing / slider / crane / push-in / overhead / floor shots, alarm cut-ins
- [x] Free camera, rack focus + details panel, TV mode
- [ ] Proxmox connector (small server, read-only API token)
- [ ] Docker image
- [ ] UniFi / generic SNMP network source
- [ ] Ambient sound (fan hum follows load)

## License

MIT. Font: JetBrains Mono (SIL OFL 1.1, see `public/fonts/OFL.txt`).
