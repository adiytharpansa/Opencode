// server.mjs — Web UI + REST API + SSE mirip opencode web (packages/app, packages/server)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, newSession, saveSession, loadSession, listSessions, readConfigFile } from "./engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const WORKDIR = process.env.WORKDIR || ROOT;
const PORT = Number(process.env.PORT || 3002);
const PUBLIC = path.join(__dirname, "..", "public");

const sessionsMemory = new Map();

async function getSession(id) {
  if (sessionsMemory.has(id)) return sessionsMemory.get(id);
  try {
    const s = await loadSession(WORKDIR, id);
    sessionsMemory.set(id, s);
    return s;
  } catch { return null; }
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*" });
      return res.end();
    }

    // ---- static ----
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await fs.readFile(path.join(PUBLIC, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ---- API ----
    if (url.pathname === "/api/config" && req.method === "GET") {
      const cfg = await readConfigFile(ROOT).catch(() => ({}));
      return send(res, 200, { workdir: WORKDIR, ...cfg });
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const list = await listSessions(WORKDIR);
      return send(res, 200, { sessions: list });
    }

    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const body = await readBody(req);
      const s = newSession(body.title || "Sesi baru");
      sessionsMemory.set(s.id, s);
      await saveSession(WORKDIR, s);
      return send(res, 200, { session: s });
    }

    const mSession = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (mSession && req.method === "GET") {
      const s = await getSession(mSession[1]);
      if (!s) return send(res, 404, { error: "session tidak ditemukan" });
      return send(res, 200, { session: s });
    }

    // POST /api/chat { sessionId?, message, provider, model, mode } -> SSE stream
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const cfg = await readConfigFile(ROOT).catch(() => ({}));
      const provider = body.provider || cfg.provider || "openai";
      const model = body.model || cfg.model || "gpt-4o-mini";
      const mode = body.mode || cfg.mode || "build";

      let session = body.sessionId ? await getSession(body.sessionId) : null;
      if (!session) {
        session = newSession(String(body.message || "Sesi baru").slice(0, 60));
        sessionsMemory.set(session.id, session);
      }
      session.messages.push({ role: "user", content: String(body.message || "") });
      session.updatedAt = new Date().toISOString();

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*"
      });
      const emit = (ev) => res.write(`data: ${JSON.stringify({ sessionId: session.id, ...ev })}\n\n`);

      try {
        const fresh = await runAgent({
          workdir: WORKDIR, provider, model, mode, config: cfg,
          messages: session.messages,
          onEvent: emit
        });
        session.messages.push(...fresh);
        session.updatedAt = new Date().toISOString();
        sessionsMemory.set(session.id, session);
        await saveSession(WORKDIR, session);
        emit({ type: "done", sessionId: session.id });
      } catch (e) {
        emit({ type: "error", error: String(e?.message || e) });
      }
      return res.end();
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); }
    });
  });
}

server.listen(PORT, () => {
  console.log(`mini-opencode web berjalan di http://localhost:${PORT}`);
  console.log(`workdir: ${WORKDIR}`);
  console.log(`referensi opencode asli: ./upstream-opencode`);
});
