// preview-server.mjs — server terpadu untuk preview: UI chat opencode + API agent.
// Dipakai start.sh agar halaman preview = aplikasi chat AI, bukan landing statis.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent, newSession, saveSession, loadSession, listSessions, readConfigFile } from "./mini-opencode/src/engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = process.env.DIST_ABS || path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 3000);
const sessionsMemory = new Map();

async function getSession(id) {
  if (sessionsMemory.has(id)) return sessionsMemory.get(id);
  try {
    const s = await loadSession(ROOT, id);
    sessionsMemory.set(id, s);
    return s;
  } catch { return null; }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(JSON.parse(buf || "{}")); } catch { resolve({}); }
    });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*" });
      return res.end();
    }

    // ---- API ----
    if (url.pathname === "/api/config" && req.method === "GET") {
      const cfg = await readConfigFile(ROOT).catch(() => ({}));
      const keyEnv = cfg.providers?.[cfg.provider || "openai"]?.apiKeyEnv;
      const hasKey = !!(keyEnv && process.env[keyEnv]);
      return send(res, 200, { workdir: ROOT, online: hasKey, hasKey, ...cfg });
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      return send(res, 200, { sessions: await listSessions(ROOT) });
    }
    if (url.pathname === "/api/sessions" && req.method === "POST") {
      const body = await readBody(req);
      const s = newSession(body.title || "Sesi baru");
      sessionsMemory.set(s.id, s);
      await saveSession(ROOT, s);
      return send(res, 200, { session: s });
    }
    const mSess = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (mSess && req.method === "GET") {
      const s = await getSession(mSess[1]);
      if (!s) return send(res, 404, { error: "session tidak ditemukan" });
      return send(res, 200, { session: s });
    }
    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const cfg = await readConfigFile(ROOT).catch(() => ({}));
      const provider = body.provider || cfg.provider || "openai";
      const model = body.model || cfg.model || "gpt-4o-mini";
      const m = body.mode || cfg.mode || "build";
      let session = body.sessionId ? await getSession(body.sessionId) : null;
      if (!session) {
        session = newSession(String(body.message || "Sesi baru").slice(0, 60));
        sessionsMemory.set(session.id, session);
      }
      session.messages.push({ role: "user", content: String(body.message || "") });
      session.updatedAt = new Date().toISOString();
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive", "access-control-allow-origin": "*" });
      const emit = (ev) => res.write(`data: ${JSON.stringify({ sessionId: session.id, ...ev })}\n\n`);
      try {
        const fresh = await runAgent({ workdir: ROOT, provider, model, mode: m, config: cfg, messages: session.messages, onEvent: emit });
        session.messages.push(...fresh);
        session.updatedAt = new Date().toISOString();
        sessionsMemory.set(session.id, session);
        await saveSession(ROOT, session);
        emit({ type: "done", sessionId: session.id });
      } catch (e) {
        emit({ type: "error", error: String(e?.message || e) });
      }
      return res.end();
    }

    // ---- static (dist) ----
    const root = path.resolve(DIST);
    let p = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (p !== root && !p.startsWith(root + path.sep)) { res.writeHead(404); return res.end(); }
    try {
      let st = fs.statSync(p);
      if (st.isDirectory()) p = path.join(p, "index.html");
    } catch { p = path.join(root, "index.html"); }
    res.setHeader("Content-Type", MIME[path.extname(p)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    return res.end(fs.readFileSync(p));
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`opencode chat berjalan di http://localhost:${PORT}`));
