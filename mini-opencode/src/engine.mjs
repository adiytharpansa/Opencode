// engine.mjs — agent loop serupa opencode: build/plan, tool-calling loop, session persist
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createToolExecutor } from "./tools.mjs";
import { chatOnce, resolveApiKey } from "./providers.mjs";

export function loadConfig(workdir) {
  const candidates = [
    path.join(workdir, "opencode.mini.json"),
    path.join(workdir, "mini-opencode", "opencode.mini.json"),
    path.join(workdir, "opencode.json")
  ];
  return { candidates };
}

export async function readConfigFile(workdir) {
  for (const f of [path.join(workdir, "opencode.mini.json"), path.join(workdir, "mini-opencode/opencode.mini.json")]) {
    try {
      const t = await fs.readFile(f, "utf8");
      return JSON.parse(t);
    } catch {}
  }
  return {};
}

export function sessionDir(workdir) {
  return path.join(workdir, ".mini-opencode", "sessions");
}

export async function saveSession(workdir, session) {
  const dir = sessionDir(workdir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
}

export async function loadSession(workdir, id) {
  const t = await fs.readFile(path.join(sessionDir(workdir), `${id}.json`), "utf8");
  return JSON.parse(t);
}

export async function listSessions(workdir) {
  try {
    const dir = sessionDir(workdir);
    const files = await fs.readdir(dir);
    const out = [];
    for (const f of files.filter((x) => x.endsWith(".json")).slice(-50)) {
      try {
        const s = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
        out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, messageCount: s.messages?.length || 0 });
      } catch {}
    }
    return out.reverse();
  } catch { return []; }
}

export function systemPrompt({ mode, workdir }) {
  return [
    `Kamu adalah mini-opencode, coding agent mirip opencode.`,
    `Workdir: ${workdir}`,
    `Mode: ${mode} (${mode === "plan" ? "read-only, dilarang write/edit/bash" : "full-access, boleh semua tools"})`,
    `Aturan:`,
    `- Gunakan tools (read/glob/grep/bash) untuk memahami kode sebelum menjawab.`,
    `- Jangan menebak isi file — baca dulu.`,
    `- Jelaskan ringkas tiap aksi tool dalam Bahasa Indonesia.`,
    `- Jika mode plan: hanya analisis, jangan menulis file.`,
    `- Maks 8 langkah tool per jawaban.`
  ].join("\n");
}

export async function runAgent({ workdir, provider, model, baseURL, apiKey, mode = "build", messages, onEvent, maxSteps = 8, config = {} }) {
  const tools = createToolExecutor({ workdir, mode, permission: config.permission });
  const provCfg = config.providers?.[provider] || {};
  const finalBaseURL = baseURL || provCfg.baseURL || "https://api.openai.com/v1";
  const finalKey = apiKey ?? resolveApiKey(provCfg);

  const convo = [
    { role: "system", content: systemPrompt({ mode, workdir }) },
    ...messages
  ];

  const newMessages = [];
  for (let step = 0; step < maxSteps; step++) {
    let reply;
    try {
      reply = await chatOnce({ provider, model, messages: convo, baseURL: finalBaseURL, apiKey: finalKey });
    } catch (e) {
      // Fallback offline: tetap berguna tanpa API key (mode demo lokal, heuristik tool sederhana)
      reply = await offlineFallback(convo, tools, workdir);
      if (!reply) throw e;
    }

    const assistantMsg = { role: "assistant", content: reply.content || "", tool_calls: reply.toolCalls?.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })) || undefined, toolCalls: reply.toolCalls };
    // simpan bentuk ringkas untuk histori
    const stored = { role: "assistant", content: reply.content || "" };
    if (reply.toolCalls?.length) stored.tool_calls = assistantMsg.tool_calls;
    convo.push({ role: "assistant", content: reply.content || "", tool_calls: assistantMsg.tool_calls, toolCalls: reply.toolCalls });
    newMessages.push(stored);
    onEvent?.({ type: "assistant", content: reply.content, toolCalls: reply.toolCalls });

    if (!reply.toolCalls?.length) break;

    for (const tc of reply.toolCalls) {
      onEvent?.({ type: "tool_start", name: tc.name, arguments: tc.arguments, id: tc.id });
      const result = await tools.run(tc.name, tc.arguments);
      const text = result.ok ? JSON.stringify(result).slice(0, 4000) : `ERROR: ${result.error}`;
      convo.push({ role: "tool", tool_call_id: tc.id, content: text });
      newMessages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: text });
      onEvent?.({ type: "tool_result", name: tc.name, id: tc.id, result });
    }
  }
  return newMessages;
}

// Fallback heuristik tanpa LLM: parse perintah sederhana "baca X", "cari Y", "list", dsb.
async function offlineFallback(convo, tools, workdir) {
  const lastUser = [...convo].reverse().find((m) => m.role === "user");
  const q = String(lastUser?.content || "");
  // hanya fallback sekali (jika sudah ada tool result, jangan loop)
  if (convo.some((m) => m.role === "tool")) {
    return { content: `Saya berjalan dalam mode offline (tanpa API key). Hasil tool di atas adalah jawaban saya. Jalankan server dengan API key OpenAI/Anthropic/Gemini/Ollama untuk jawaban LLM penuh.`, toolCalls: [] };
  }
  const mRead = q.match(/baca(?:kan)?\s+([^\s]+)/i);
  const mList = /list|daftar file|struktur/i.test(q);
  const mSearch = q.match(/cari(?:kan)?\s+[“"]?(.+?)[”"]?\s*(?:di|$)/i);
  if (mRead) return { content: "Saya bacakan file yang diminta:", toolCalls: [{ id: "call_read", name: "read", arguments: { path: mRead[1].trim() } }] };
  if (mList) return { content: "Saya daftar file proyek:", toolCalls: [{ id: "call_glob", name: "glob", arguments: { pattern: "**/*.mjs" } }] };
  if (mSearch) return { content: `Saya carikan pola tersebut:`, toolCalls: [{ id: "call_grep", name: "grep", arguments: { pattern: mSearch[1].trim() } }] };
  return null;
}

export function newSession(title = "Sesi baru") {
  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  return { id, title: title.slice(0, 80), createdAt: now, updatedAt: now, messages: [] };
}
