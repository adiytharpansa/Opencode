// providers.mjs — multi-provider LLM mirip opencode (75+ provider via OpenAI-compatible + native Anthropic/Gemini)
import { TOOL_SCHEMAS } from "./tools.mjs";

export function resolveApiKey(providerCfg = {}) {
  if (!providerCfg.apiKeyEnv) return "";
  return process.env[providerCfg.apiKeyEnv] || "";
}

function toAnthropicTools(openAiTools) {
  return (openAiTools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));
}

export async function chatOnce({ provider = "openai", model, messages, baseURL, apiKey }) {
  if (provider === "anthropic") return chatAnthropic({ model, messages, baseURL, apiKey });
  if (provider === "gemini") return chatGemini({ model, messages, baseURL, apiKey });
  return chatOpenAICompatible({ model, messages, baseURL, apiKey });
}

// --- OpenAI-compatible (OpenAI, Ollama, OpenRouter, Groq, LMStudio, Zen, dll) ---
async function chatOpenAICompatible({ model, messages, baseURL, apiKey }) {
  const url = baseURL.replace(/\/$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages: messages.map(stripToolMeta),
      tools: TOOL_SCHEMAS,
      tool_choice: "auto",
      temperature: 0.2
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  if (!choice) throw new Error("Respons LLM kosong");
  return normalizeOpenAiMessage(choice);
}

function stripToolMeta(m) {
  if (m.role === "assistant" && m.tool_calls) {
    return { role: "assistant", content: m.content || "", tool_calls: m.tool_calls };
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: String(m.content ?? "") };
  return m;
}

function normalizeOpenAiMessage(choice) {
  const toolCalls = (choice.tool_calls || [])
    .filter((tc) => tc.type === "function" || tc.function)
    .map((tc, i) => {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = { _raw: tc.function?.arguments }; }
      return { id: tc.id || `call_${i}`, name: tc.function?.name, arguments: args };
    });
  return { content: choice.content || "", toolCalls };
}

// --- Anthropic native ---
async function chatAnthropic({ model, messages, baseURL, apiKey }) {
  const url = (baseURL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => {
    if (m.role === "assistant" && m.tool_calls) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      return { role: "assistant", content };
    }
    if (m.role === "tool") {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") }] };
    }
    return { role: m.role === "tool" ? "user" : m.role, content: String(m.content ?? "") };
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model, max_tokens: 2000, system: system || undefined, messages: rest, tools: toAnthropicTools(TOOL_SCHEMAS) })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const toolCalls = (data.content || []).filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: b.input }));
  return { content: text, toolCalls };
}

// --- Gemini native (generateContent) ---
async function chatGemini({ model, messages, baseURL, apiKey }) {
  const host = (baseURL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const url = `${host}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey || "")}`;
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.role === "tool" ? `Tool ${m.tool_call_id} result:\n${m.content}` : String(m.content ?? "") }]
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: messages.find((m) => m.role === "system")?.content || "" }] },
      contents,
      tools: [{ function_declarations: TOOL_SCHEMAS.map((t) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }]
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => p.text).map((p) => p.text).join("");
  const toolCalls = parts.filter((p) => p.functionCall).map((fc, i) => ({ id: `call_${i}`, name: fc.functionCall.name, arguments: fc.functionCall.args || {} }));
  return { content: text, toolCalls };
}
