# Security

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's [private vulnerability reporting](https://github.com/csiber/rackscape/security/advisories/new) or email **info@promnet.hu**. You'll get an answer within a few days.

## Design

- Rackscape is **read-only**. The recommended Proxmox role is `PVEAuditor`; the connector only issues `GET` requests.
- The API token stays on the server. Browsers receive only the rendered snapshot (`/api/snapshot`).
- The snapshot reveals your infrastructure layout: guest names, IDs, load and storage sizes. **Don't expose Rackscape to the internet without protection**: set `BASIC_AUTH`, put it behind your reverse proxy's auth, or bind it to `127.0.0.1` and [embed](https://github.com/csiber/rackscape/wiki/Embedding) it in an app that already has login.
- Prefer `PVE_CA` (the cluster's `pve-root-ca.pem`) over `PVE_INSECURE=1`.
- The static file server rejects path traversal and only answers `GET`/`HEAD`.
