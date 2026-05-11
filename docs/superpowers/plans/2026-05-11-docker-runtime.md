# Docker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the macOS LaunchAgent/tmux runtime with a Docker Compose runtime for the existing Bun web app.

**Architecture:** Keep the source tree and Git workflow unchanged. Add a Bun-based container image and a Compose service that binds host port `127.0.0.1:3042` to the container, persists `./data` into `/app/data`, and restarts unless explicitly stopped.

**Tech Stack:** Bun, TypeScript, Docker, Docker Compose, macOS/OrbStack.

---

### Task 1: Add Docker Runtime Files

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Modify: `README.md`

- [ ] **Step 1: Add `.dockerignore`**

```text
.DS_Store
.codex/
.git/
node_modules/
logs/
*.log
data/*.json
data/*.tmp
```

- [ ] **Step 2: Add `Dockerfile`**

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=3042
ENV READLATER_DATA=/app/data/readlater.json

EXPOSE 3042

CMD ["bun", "src/server.ts"]
```

- [ ] **Step 3: Add `compose.yaml`**

```yaml
services:
  read-it-later:
    build: .
    restart: unless-stopped
    environment:
      HOST: 0.0.0.0
      PORT: 3042
      READLATER_DATA: /app/data/readlater.json
    ports:
      - "127.0.0.1:3042:3042"
    volumes:
      - ./data:/app/data
```

- [ ] **Step 4: Document Docker commands in `README.md`**

Add a Docker section with:

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

### Task 2: Verify Locally

**Files:**
- Test: `Dockerfile`
- Test: `compose.yaml`
- Test: `src/server.ts`

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`

Expected: command exits `0`.

- [ ] **Step 2: Run tests**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 3: Build and start Compose service**

Run: `docker compose up -d --build`

Expected: service starts and `docker compose ps` shows `read-it-later` running.

- [ ] **Step 4: Verify HTTP endpoint**

Run: `curl -fsS http://127.0.0.1:3042/ >/tmp/read-it-later-index.html`

Expected: command exits `0`.

### Task 3: Commit, Push, and Deploy on Home Host

**Files:**
- Remote path: `/Users/cz/Projects/read-it-later`

- [ ] **Step 1: Commit Docker runtime files**

```bash
git add .dockerignore Dockerfile compose.yaml README.md docs/superpowers/plans/2026-05-11-docker-runtime.md
git commit -m "Add Docker runtime"
```

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

- [ ] **Step 3: Disable old home-host runtime**

```bash
ssh home 'cd /Users/cz/Projects/read-it-later && bun run stop || true'
ssh home 'launchctl list | grep -E "riablo|read-it-later" || true'
```

- [ ] **Step 4: Pull and run Docker runtime on home host**

```bash
ssh home 'cd /Users/cz/Projects/read-it-later && git pull --ff-only && docker compose up -d --build'
ssh home 'cd /Users/cz/Projects/read-it-later && docker compose ps'
ssh home 'curl -fsS http://127.0.0.1:3042/ >/tmp/read-it-later-index.html'
```
