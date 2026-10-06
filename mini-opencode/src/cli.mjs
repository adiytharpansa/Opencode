// cli.mjs — TUI terminal interaktif mirip `opencode` / `opencode run`
import readline from "node:readline";
import path from "node:path";
import { runAgent, readConfigFile } from "./engine.mjs";

const ROOT = path.resolve(process.argv[2] || process.cwd());
const cfg = await readConfigFile(path.resolve("." )).catch(() => ({})).catch(() => ({}));
const config = { provider: "openai", model: "gpt-4o-mini", mode: "build", ...cfg };

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--provider") config.provider = process.argv[++i];
  if (process.argv[i] === "--model") config.model = process.argv[++i];
  if (process.argv[i] === "--mode") config.mode = process.argv[++i];
  if (process.argv[i] === "--help" || process.argv[i] === "-h") {
    console.log(`mini-opencode CLI (mirip opencode TUI)\n\n  node mini-opencode/src/cli.mjs [workdir] [--provider openai] [--model gpt-4o-mini] [--mode build|plan]\n\nEnv API key: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY\nTanpa API key: berjalan mode offline (tools lokal + heuristik).`);
    process.exit(0);
  }
}

console.log(`mini-opencode CLI — provider=${config.provider} model=${config.model} mode=${config.mode}`);
console.log(`workdir=${ROOT}  (ketik /mode, /model, /quit, /help)`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));
const history = [];

while (true) {
  const input = (await ask("\n> ")).trim();
  if (!input) continue;
  if (input === "/quit" || input === "/exit") break;
  if (input === "/help") { console.log("/mode build|plan  /model <nama>  /provider <nama>  /quit"); continue; }
  if (input.startsWith("/mode")) { config.mode = input.split(/\s+/)[1] || config.mode; console.log("mode =", config.mode); continue; }
  if (input.startsWith("/model")) { config.model = input.split(/\s+/).slice(1).join(" ") || config.model; console.log("model =", config.model); continue; }
  if (input.startsWith("/provider")) { config.provider = input.split(/\s+/)[1] || config.provider; console.log("provider =", config.provider); continue; }

  history.push({ role: "user", content: input });
  try {
    const fresh = await runAgent({
      workdir: ROOT, provider: config.provider, model: config.model,
      mode: config.mode, config, messages: history,
      onEvent: (ev) => {
        if (ev.type === "assistant" && ev.content) console.log(`\n${ev.content}`);
        if (ev.type === "tool_start") console.log(`  🔧 ${ev.name} ${JSON.stringify(ev.arguments).slice(0, 200)}`);
        if (ev.type === "tool_result") console.log(`  ✅ ${ev.name}: ${ev.result.ok ? "ok" : "GAGAL: " + ev.result.error}`);
      }
    });
    history.push(...fresh);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
rl.close();
