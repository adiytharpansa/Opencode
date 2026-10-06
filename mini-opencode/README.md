# mini-opencode — aplikasi serupa opencode

> Hasil dari permintaan: **"Clone opencode disini, lalu buatkan aplikasi dengan fitur serupa"**.

- Referensi asli sudah di-clone ke `./upstream-opencode` (`https://github.com/sst/opencode`, depth-1).
  Fitur yang ditiru (versi ringan, zero-dependency Node.js):
  | Fitur opencode asli | mini-opencode |
  |---|---|
  | TUI terminal interaktif | `src/cli.mjs` (readline, `/mode /model /provider`) |
  | Web / desktop app | `src/server.mjs` + `public/index.html` (port 3002) |
  | Multi-provider 75+ (OpenAI, Anthropic, Gemini, Ollama, OpenRouter…) | `src/providers.mjs` (OpenAI-compatible + native Anthropic/Gemini) |
  | Tools: read, edit, glob, grep, bash, webfetch, LSP | `src/tools.mjs` (read/write/edit/glob/grep/bash/webfetch) |
  | Session persist (SQLite) | JSON di `.mini-opencode/sessions/*.json` |
  | Agent `build` (full) vs `plan` (read-only) | `mode` di engine + gate permission |
  | `opencode.json` config | `opencode.mini.json` (subset kompatibel) |
  | SSE streaming | `POST /api/chat` → `text/event-stream` |

## Menjalankan

```bash
# 1. CLI (tanpa API key = mode offline, tools lokal tetap jalan)
node mini-opencode/src/cli.mjs

# dengan LLM:
OPENAI_API_KEY=xxx node mini-opencode/src/cli.mjs --provider openai --model gpt-4o-mini --mode build
ANTHROPIC_API_KEY=xxx node mini-opencode/src/cli.mjs --provider anthropic --model claude-sonnet-4-5
GEMINI_API_KEY=xxx node mini-opencode/src/cli.mjs --provider gemini --model gemini-2.5-flash
# Ollama lokal (tanpa key):
node mini-opencode/src/cli.mjs --provider ollama --model qwen2.5-coder

# 2. Web UI (mirip opencode web)
PORT=3002 node mini-opencode/src/server.mjs
# buka http://localhost:3002

# 3. Demo verifikasi offline
node mini-opencode/src/demo.mjs
```

## Struktur

```
upstream-opencode/      # clone referensi sst/opencode (read-only, jangan diedit)
mini-opencode/
  opencode.mini.json    # contoh config (provider, model, mode, permission)
  public/index.html     # webchat UI
  src/tools.mjs         # eksekutor tools
  src/providers.mjs     # client LLM multi-provider
  src/engine.mjs        # agent loop + sessions
  src/server.mjs        # HTTP + SSE API
  src/cli.mjs           # TUI terminal
  src/demo.mjs          # smoke test offline
```

## Catatan

- Tanpa API key, engine memakai `offlineFallback` (heuristik baca/list/cari) sehingga tools tetap bisa didemokan.
- Dengan API key, loop tool-calling penuh aktif (maks 8 langkah), sama pola seperti opencode: `chat → tool_calls → execute → ulangi`.
