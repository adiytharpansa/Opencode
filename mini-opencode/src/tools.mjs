// tools.mjs — implementasi tools serupa opencode: read, write, edit, glob, grep, bash, webfetch
// Referensi tool asli: upstream-opencode/packages/opencode/src/tool/
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Baca isi file (max 200 baris default). Mirip tool read opencode.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path file relatif/absolut" },
          offset: { type: "number", description: "Baris mulai (1-based)" },
          limit: { type: "number", description: "Jumlah baris" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write",
      description: "Tulis/overwrite file. Membuat direktori bila perlu.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit",
      description: "Ganti exact string oldString dengan newString di file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldString: { type: "string" },
          newString: { type: "string" }
        },
        required: ["path", "oldString", "newString"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Cari file dengan pola glob sederhana (* dan **).",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, cwd: { type: "string" } },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Cari teks (regex) di dalam file.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          include: { type: "string", description: "filter mis. *.js" },
          cwd: { type: "string" }
        },
        required: ["pattern"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Jalankan perintah shell (read-only dianjurkan di plan mode).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          workdir: { type: "string" },
          timeout: { type: "number" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "webfetch",
      description: "Ambil konten URL (text).",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"]
      }
    }
  }
];

function resolveSafe(root, p) {
  const abs = path.resolve(root, p);
  return abs;
}

export function createToolExecutor({ workdir, mode = "build", permission = {} }) {
  const planBlocks = new Set(permission.planBlocks ?? ["write", "edit", "bash"]);
  const root = path.resolve(workdir || process.cwd());

  async function checkAllowed(name) {
    if (mode === "plan" && planBlocks.has(name)) {
      return { allowed: false, reason: `mode=plan memblokir tool '${name}' (read-only). Ganti ke mode build untuk menulis.` };
    }
    return { allowed: true };
  }

  return {
    root,
    async run(name, args = {}) {
      const gate = await checkAllowed(name);
      if (!gate.allowed) return { ok: false, error: gate.reason };

      try {
        switch (name) {
          case "read": {
            const fp = resolveSafe(root, args.path);
            const text = await fs.readFile(fp, "utf8");
            const lines = text.split("\n");
            const offset = Math.max(1, Number(args.offset || 1));
            const limit = Math.min(500, Number(args.limit || 200));
            const slice = lines.slice(offset - 1, offset - 1 + limit);
            return { ok: true, path: fp, totalLines: lines.length, offset, content: slice.join("\n") };
          }
          case "write": {
            const fp = resolveSafe(root, args.path);
            await fs.mkdir(path.dirname(fp), { recursive: true });
            await fs.writeFile(fp, args.content ?? "", "utf8");
            return { ok: true, path: fp, bytes: Buffer.byteLength(args.content ?? "") };
          }
          case "edit": {
            const fp = resolveSafe(root, args.path);
            const text = await fs.readFile(fp, "utf8");
            if (!text.includes(args.oldString)) return { ok: false, error: "oldString tidak ditemukan" };
            const next = text.replace(args.oldString, args.newString);
            await fs.writeFile(fp, next, "utf8");
            return { ok: true, path: fp };
          }
          case "glob": {
            const { globFiles } = await import("./glob-util.mjs").catch(() => ({ globFiles: null }));
            const cwd = args.cwd ? resolveSafe(root, args.cwd) : root;
            if (globFiles) return { ok: true, files: await globFiles(cwd, args.pattern) };
            // fallback sederhana tanpa dep: list rekursif + filter *.
            const out = [];
            async function walk(dir) {
              const ents = await fs.readdir(dir, { withFileTypes: true });
              for (const e of ents) {
                if (e.name === "node_modules" || e.name === ".git" || e.name === "upstream-opencode") continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { if (out.length < 500) await walk(full); }
                else out.push(path.relative(root, full));
              }
            }
            await walk(cwd);
            const rx = globToRegExp(args.pattern);
            return { ok: true, files: out.filter((f) => rx.test(f)).slice(0, 200) };
          }
          case "grep": {
            const cwd = args.cwd ? resolveSafe(root, args.cwd) : root;
            const rx = new RegExp(args.pattern, "m");
            const results = [];
            async function walk(dir) {
              if (results.length > 100) return;
              let ents;
              try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
              for (const e of ents) {
                if (results.length > 100) break;
                if (e.name === "node_modules" || e.name === ".git" || e.name === "upstream-opencode") continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) await walk(full);
                else {
                  if (args.include && !full.endsWith(args.include.replace("*", ""))) continue;
                  try {
                    const t = await fs.readFile(full, "utf8");
                    const lines = t.split("\n");
                    lines.forEach((ln, i) => {
                      if (results.length > 100) return;
                      if (rx.test(ln)) results.push({ file: path.relative(root, full), line: i + 1, text: ln.slice(0, 300) });
                    });
                  } catch {}
                }
              }
            }
            await walk(cwd);
            return { ok: true, matches: results };
          }
          case "bash": {
            const cmd = args.command;
            if (/rm\s+-rf\s+\/( |$)/.test(cmd)) return { ok: false, error: "perintah berbahaya diblokir" };
            const out = await runShell(cmd, { cwd: args.workdir ? resolveSafe(root, args.workdir) : root, timeout: args.timeout ?? 30000 });
            return { ok: true, ...out };
          }
          case "webfetch": {
            const r = await fetch(args.url, { headers: { "user-agent": "mini-opencode/0.1" } });
            const t = await r.text();
            return { ok: true, status: r.status, content: t.slice(0, 8000) };
          }
          default:
            return { ok: false, error: `tool tidak dikenal: ${name}` };
        }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
  };
}

function globToRegExp(pattern = "**") {
  // konversi sederhana: ** -> .* , * -> [^/]* , ? -> .
  let rx = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") { rx += ".*"; i++; }
      else rx += "[^/]*";
    } else if (c === "?") rx += ".";
    else if ("+()^$.{}|[]\\".includes(c)) rx += "\\" + c;
    else rx += c;
  }
  return new RegExp(rx + "$");
}

function runShell(command, { cwd, timeout }) {
  return new Promise((resolve) => {
    const child = execFile("bash", ["-lc", command], { cwd, timeout }, (err, stdout, stderr) => {
      resolve({
        command,
        exitCode: err?.code ?? 0,
        stdout: String(stdout || "").slice(0, 8000),
        stderr: String(stderr || "").slice(0, 4000),
        error: err ? String(err.message).slice(0, 500) : undefined
      });
    });
  });
}
