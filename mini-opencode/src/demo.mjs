// demo.mjs — verifikasi tools + engine tanpa API key (mode offline)
import { createToolExecutor } from "./tools.mjs";
import { runAgent } from "./engine.mjs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
console.log("ROOT =", ROOT);

const tools = createToolExecutor({ workdir: ROOT, mode: "build", permission: {} });
console.log("1) read package:", await tools.run("read", { path: "mini-opencode/package.json", limit: 10 }));
console.log("2) glob:", (await tools.run("glob", { pattern: "mini-opencode/src/*.mjs" })));
console.log("3) grep:", (await tools.run("grep", { pattern: "runAgent", include: "*.mjs" })));
console.log("4) bash:", await tools.run("bash", { command: "ls mini-opencode/src" }));

// plan mode harus memblokir write
const planTools = createToolExecutor({ workdir: ROOT, mode: "plan", permission: {} });
console.log("5) plan blocks write:", await planTools.run("write", { path: "/tmp/x.txt", content: "hi" }));

// agent offline fallback
const out = await runAgent({
  workdir: ROOT, provider: "openai", model: "offline", mode: "build", config: {},
  messages: [{ role: "user", content: "bacakan mini-opencode/package.json" }],
  onEvent: (e) => console.log("event:", e.type, e.name || "", (e.content || "").slice(0, 80))
});
console.log("6) agent messages:", out.length, "OK");
console.log("DEMO SELESAI — semua checks di atas harus ok:true kecuali plan-block.");
