import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const apiKey = () => {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY not configured");
  return k;
};

async function callAI(system: string, user: string, model = "google/gemini-2.5-flash") {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error("Rate limit reached. Wait and retry.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings.");
    throw new Error(`AI error (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

function stripFences(s: string): string {
  const m = s.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
  return m ? m[1] : s.trim();
}

const ActionInput = z.object({
  action: z.enum(["generate", "correct", "explain", "refactor", "optimize", "comment"]),
  language: z.string().max(50).optional(),
  path: z.string().max(500).optional(),
  code: z.string().max(40000).default(""),
  prompt: z.string().max(4000).optional(),
});

export const aiCodeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ActionInput.parse(d))
  .handler(async ({ data }) => {
    const lang = data.language ?? "";
    const ctx = `File: ${data.path ?? "(untitled)"} | Language: ${lang}`;
    let system = "You are Cortex, an expert software engineer.";
    let user = "";
    let mode: "code" | "markdown" = "code";

    switch (data.action) {
      case "generate":
        system += " Output ONLY raw code in a single fenced block. No prose.";
        user = `${ctx}\n\nTask: ${data.prompt ?? "Write the requested code."}\n\nExisting code (may be empty):\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
      case "correct":
        system += " Fix syntax and logic bugs. Output ONLY the corrected code in one fenced block.";
        user = `${ctx}\n\nFix this code:\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
      case "refactor":
        system += " Refactor for clarity and maintainability. Preserve behavior. Output ONLY the new code in one fenced block.";
        user = `${ctx}\n\nRefactor:\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
      case "optimize":
        system += " Optimize for performance and readability. Preserve behavior. Output ONLY the optimized code in one fenced block.";
        user = `${ctx}\n\nOptimize:\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
      case "comment":
        system += " Add concise doc comments and inline comments. Output ONLY the commented code in one fenced block.";
        user = `${ctx}\n\nAdd comments:\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
      case "explain":
        mode = "markdown";
        system += " Explain code clearly in Markdown.";
        user = `${ctx}\n\nExplain this code. Cover: logic flow, key functions, variables, APIs used, possible performance issues.\n\n\`\`\`${lang}\n${data.code}\n\`\`\``;
        break;
    }

    const raw = await callAI(system, user);
    return mode === "code" ? { content: stripFences(raw), mode } : { content: raw, mode };
  });

const TerminalInput = z.object({
  cwd: z.string().max(500).default("/"),
  command: z.string().min(1).max(2000),
  history: z.array(z.object({ cmd: z.string(), out: z.string() })).max(20).default([]),
  repo: z.string().max(200).optional(),
});

export const aiTerminal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TerminalInput.parse(d))
  .handler(async ({ data }) => {
    const system =
      "You are a simulated POSIX shell for an AI dev workspace. Given a command, respond with the plausible terminal output ONLY (no markdown, no commentary). Keep output realistic and short. If the command would harm a real system, refuse briefly.";
    const hist = data.history.map((h) => `$ ${h.cmd}\n${h.out}`).join("\n");
    const user = `Repo: ${data.repo ?? "n/a"}\nCWD: ${data.cwd}\n\nHistory:\n${hist}\n\nCommand:\n$ ${data.command}`;
    const out = await callAI(system, user, "google/gemini-2.5-flash-lite");
    return { output: out };
  });