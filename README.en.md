<p align="center"><img src="public/brand/tigerai-logo.png" alt="TigerAI" width="140"></p>

# OpenAgent Portal (based on pi-agent and pi-web)

**A self-hosted AI agent portal for teams, in companies and in schools.** Channels, task assignments, skills and n8n, all running on your own machine.

[繁體中文](README.md) · Community Edition 1.1.x-ce · no user limit

---

## Why

Personal AI agent tools serve one person at a time. Teams need something else:

- **Shared channels and records**: what was said, what was decided and who promised what is kept and can be followed up.
- **Governance**: accounts and administrators, an audit log, and a review before a workflow is published for others.
- **Local models with a backup**: your own model day to day, a backup only when the main connection is down.

OpenAgent Portal adds these on top of pi-agent / pi-web. The AI only writes drafts and suggestions; confirming, adopting, completing and approving are done by people.

## Start with a story

Two fictional stories, each walking through the whole product (the story files are in [`docs/stories/`](docs/stories/)):

- **[Taiwan Tech Precision: Three Months to Follow One Order All the Way Through](docs/stories/SME_Story_v1.0_en.md)** ([繁體中文](docs/stories/中小企業主_故事_v1.0.md))
  Employees first leave a record of their work in their own words; the company turns the records, step by step, into work that can be handed over and tracked. From company-wide, department and project channels it grows into a **Company Brain**.
- **[Learning AI Agents: Professor Wang's Semester](docs/stories/School_Story_v1.0_en.md)** ([繁體中文](docs/stories/學校課程_故事_v1.0.md))
  Students learn not "how to ask AI" but how to read the details and get AI to do the job right: from writing prompts to building skills and n8n workflows.

The companies, schools, people and numbers in the stories are fictional.

## Community Edition features

| Area | Features |
|---|---|
| Daily work | Chat (images, .md/.txt attachments); channels (company-wide / department / project, with @AI); task assignments (to a person or to the AI, a person confirms when done); bulletin board and bell; prompts (your own, `#` to call, shareable) |
| Skills | Built-in skills (with their tools): fill in an application form, research the web, make a report slide deck, n8n workflow helper; "copy as mine" or write your own. A skill never grants extra permissions |
| Wizards (summaries and analysis) | Daily digest, weekly work report and message analysis, each looking at work from five angles (record, supervise, audit, remind, suggest) with a source on every item; plus skill suggestions and meeting summaries (upload a recording or paste a transcript; needs a separate speech-to-text service) |
| Web and documents | Web research (SearXNG; only the search keywords are sent); report slide decks and filled-in PDF forms (Gotenberg conversion) |
| n8n | Simple webhooks (Portal calls n8n, n8n calls Portal) and the **n8n MCP**. The Community Edition opens only the n8n MCP, as an MCP demo. Anyone can build and test their own flows; only publishing a flow for others needs administrator review |
| Models | Several connections in priority order; local model plus backup; personal keys per user (including a free NVIDIA option), with personal and shared connections backing each other up |
| Accounts and admin | Self-registration with a passphrase and approval; organization `org.xlsx` import; user records (last seen, time spent, CSV export); audit log; idle auto-logout |

More (MCP hub, MCP for other systems, Gitea archiving, operating-flywheel and workflow templates, API Proxy) belongs to the consulting package or the custom commercial edition; see [EDITIONS.md](EDITIONS.md).

## Quick start (Docker)

**You need** a machine that runs Docker (with `docker compose`). Image:

```
ghcr.io/tigerai-taiwan/openagent-portal:1.1.2-ce
```

> Default port: **30161**. To build the image yourself from source: `docker compose up -d --build` (same tag).

The Portal and the other three services are **four separate containers**. The Portal admin page only takes a URL and a test button. The Portal is required; SearXNG (web research), Gotenberg (slide/PDF conversion) and n8n (workflows) are optional and switched on by compose profiles.

`.env` (copy `.env.example` and fill in; **never commit it**). These three lines are the minimum, everything else has a default:

```env
TIGERAI_ADMIN_EMAIL=you@example.com
TIGERAI_ADMIN_PASSWORD=<a long password>
TZ=Asia/Taipei
```

Add these only for the optional services (next section): `COMPOSE_PROFILES=search,convert,n8n`, `SEARXNG_SECRET=<random string>`, `N8N_ENCRYPTION_KEY=<random string>`. To allow LAN access set `PI_WEB_BIND=0.0.0.0` and list the host names people type in the browser in `PI_WEB_ALLOWED_HOSTS` (comma separated). Port: `PI_WEB_PORT` (default 30161).

`compose.yaml` (ships in the repo; excerpt; the service is called `pi-web`):

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

The optional services are **not** started by a plain `docker compose up -d`; switch on the ones you want:

```
docker compose --profile search --profile convert --profile n8n up -d
```

Then:

1. `docker compose up -d` (add `--profile …` for the optional services) and open <http://127.0.0.1:30161>.
2. Sign in with the administrator from `.env`. **You must change the password at first sign-in** before you can continue.
3. **Settings -> Model connection**: enter your model service (OpenAI-compatible `/v1` URL and key) and press Test. With no local model you can use a free NVIDIA model directly; with a local model, add NVIDIA as the **backup** (used only when the local model is down; the screen says so, and it can be turned off). Without a model, chat and the wizards do not answer.
4. **Settings -> Admin**: enter and test the SearXNG (`http://searxng:8080`), Gotenberg (`http://gotenberg:3000`) and n8n (`http://n8n:5678`) URLs; create units and members, or turn on passphrase self-registration.

The **speech-to-text service for meeting summaries is separate** (an OpenAI-compatible transcription endpoint); the Portal does not include one. All data lives in Docker volumes; a backup is a copy of the volumes.

## Data and privacy

Normally all data stays on your machine. Only if you have configured a backup (for example NVIDIA) or a member added a personal key, and the local model fails or that member chooses it, are conversations sent to the model provider you chose; the screen shows it. Web search sends only the search keywords. **Administrators can read members' conversations** (read-only, every view is audited), and the members' settings page always says so.

## Editions

| | Community (this repo) | Consulting package | Custom commercial |
|---|---|---|---|
| What | Everything above, **no user limit** | A consultant connects your workflows and systems | Per-person permissions, core-system integration |
| How to get it | Install it yourself | From a consultant licensed by TigerAI | Talk to TigerAI |

> Everything in the Community Edition you can do yourselves. If you want to save time, avoid detours, or have someone accountable for delivery and handover, come to our consulting service.

## Manuals

Teacher's manual and SME adoption manual: **PDF manuals and class slides are available from TigerAI on request.**

## Credits and license

- Upstream: [pi-web](https://github.com/agegr/pi-web) (by agegr, MIT) and [pi-agent / pi](https://github.com/earendil-works/pi) (by earendil-works, MIT). License notices are in [NOTICE](NOTICE). This project is **not** an official upstream release.
- The `tigerai/` directory is under the TigerAI Sustainable Use License (**draft, pending legal review**). The logo is a TigerAI trademark and is not covered by the code license.

By Morris Lu (盧業興) · n8n Taipei Ambassador · TigerAI (虎智科技), an n8n Expert Partner.
For usage questions, contact TigerAI (tiger.ai.tw@gmail.com).

---

## Upstream pi-web quick start (without the TigerAI layer)

Without `TIGERAI_ENABLED`, this project behaves like upstream pi-web. For the upstream npx quick start, configuration, remote access and development notes, see [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md) (the current README sections from "上游 pi-web 的快速開始" onward, moved there).
