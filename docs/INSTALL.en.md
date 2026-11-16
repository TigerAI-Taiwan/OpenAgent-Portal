# Installing OpenAgent Portal (Docker)

[繁體中文](INSTALL.md) · [Back to the front page](../README.en.md)

The front page keeps only the shortest path. This page is the full version: the image, `.env`, `compose.yaml`, optional services, LAN access and speech-to-text.

---

## What you need

A machine that runs Docker (with `docker compose`). Image:

```
ghcr.io/tigerai-taiwan/openagent-portal:1.1.2-ce
```

> Default port: **30161**. To build the image yourself from source: `docker compose up -d --build` (same tag).

The Portal and the other three services are **separate containers**. The Portal admin page only takes a URL and a test button:

| Service | What it is for | Required |
|---|---|---|
| Portal (`pi-web`) | Chat, channels, task assignments, skills, wizards | Yes |
| SearXNG | Web research (only the search keywords are sent) | Optional |
| Gotenberg | Conversion for report slide decks and filled-in PDF forms | Optional |
| n8n | Workflows | Optional |

## `.env`

Copy `.env.example` to `.env` and fill it in; **never commit it**. These three lines are the minimum, everything else has a default:

```env
TIGERAI_ADMIN_EMAIL=you@example.com
TIGERAI_ADMIN_PASSWORD=<a long password>
TZ=Asia/Taipei
```

Other common settings:

| Variable | Purpose |
|---|---|
| `COMPOSE_PROFILES=search,convert,n8n` | Add only for the optional services (next section) |
| `SEARXNG_SECRET=<random string>` | Fill in before starting the search profile |
| `N8N_ENCRYPTION_KEY=<random string>` | Fill in before starting n8n; n8n encrypts its saved credentials with it |
| `PI_WEB_BIND=0.0.0.0` | To allow LAN access (default `127.0.0.1`, this machine only) |
| `PI_WEB_ALLOWED_HOSTS` | Required for LAN access: the host names people type in the browser, comma separated |
| `PI_WEB_PORT` | Host-side port, default 30161 |
| `TZ` | Time zone; schedules (such as the daily digest and overdue days) use it |

Every entry in `.env.example` is commented.

## `compose.yaml`

Ships in the repo; excerpt below. The service is called `pi-web`:

```yaml
services:
  pi-web:
    image: ghcr.io/tigerai-taiwan/openagent-portal:${OAP_IMAGE_TAG:-1.1.2-ce}
    restart: unless-stopped
    environment:
      PORT: "30161"
      TIGERAI_ENABLED: "1"
      TIGERAI_ADMIN_EMAIL: ${TIGERAI_ADMIN_EMAIL:-adm@local}
      TIGERAI_ADMIN_PASSWORD: ${TIGERAI_ADMIN_PASSWORD:-}
      TZ: ${TZ:-Asia/Taipei}
    ports: ["${PI_WEB_BIND:-127.0.0.1}:${PI_WEB_PORT:-30161}:30161"]
    volumes: [pi-agent-data:/home/node/.pi/agent, pi-cwd-data:/home/node/pi-cwd]

  # optional services, off by default (compose profiles): searxng (search), gotenberg (convert), n8n (n8n)
  searxng:   { profiles: [search],  image: "searxng/searxng:2026.9.5-c7f3080aa" }   # internal only; needs docs/searxng-settings.yml (included)
  gotenberg: { profiles: [convert], image: "gotenberg/gotenberg:8.21.1" }          # internal only
  n8n:       { profiles: [n8n],     image: "docker.n8n.io/n8nio/n8n:2.44.6" }      # editor bound to this machine, 127.0.0.1:5678
```

## Optional services

The optional services are **not** started by a plain `docker compose up -d`; switch on the ones you want:

```
docker compose --profile search --profile convert --profile n8n up -d
```

## After starting

1. `docker compose up -d` (add `--profile …` for the optional services) and open <http://127.0.0.1:30161>.
2. Sign in with the administrator from `.env`. **You must change the password at first sign-in** before you can continue.
3. **Settings -> Model connection**: enter your model service (OpenAI-compatible `/v1` URL and key) and press Test. With no local model you can use a free NVIDIA model directly; with a local model, add NVIDIA as the **backup** (used only when the local model is down; the screen says so, and it can be turned off). Without a model, chat and the wizards do not answer.
4. **Settings -> Admin**: enter and test the SearXNG (`http://searxng:8080`), Gotenberg (`http://gotenberg:3000`) and n8n (`http://n8n:5678`) URLs; create units and members, or turn on passphrase self-registration.

## Speech-to-text and backups

- The **speech-to-text service for meeting summaries is separate** (an OpenAI-compatible transcription endpoint); the Portal does not include one. Without it, meeting summaries still work from a pasted transcript.
- All data lives in Docker volumes; a backup is a copy of the volumes.

## Without the TigerAI layer

Without `TIGERAI_ENABLED`, this project behaves like upstream pi-web; see [UPSTREAM_README.md](UPSTREAM_README.md) (in Chinese).
