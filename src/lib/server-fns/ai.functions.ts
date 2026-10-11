import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(20000),
});

const ChatInput = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  system: z.string().max(4000).optional(),
  model: z.string().max(100).optional(),
});

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ChatInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const sys =
      data.system ??
      "You are Cortex, an expert AI developer co-pilot. Explain code clearly and concisely using Markdown. Use short paragraphs and bullet lists. When asked about a repository or file, focus on architecture, key functions, and dependencies.";

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: data.model ?? "google/gemini-2.5-flash",
        messages: [{ role: "system", content: sys }, ...data.messages],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("Rate limit reached. Please wait and try again.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      throw new Error(`AI gateway error (${res.status}): ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { content };
  });

const ExplainInput = z.object({
  path: z.string().min(1).max(500),
  code: z.string().min(1).max(40000),
  language: z.string().max(50).optional(),
});

export const explainFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ExplainInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    // Persistent cache by (path + content hash + language)
    const hash = createHash("sha256")
      .update(`${data.path}\u0000${data.language ?? ""}\u0000${data.code}`)
      .digest("hex");
    const cacheId = hash.slice(0, 32);
    try {
      const { data: row } = await supabaseAdmin
        .from("ai_explain_cache")
        .select("explanation")
        .eq("id", cacheId)
        .maybeSingle();
      if (row?.explanation) return { content: row.explanation, cached: true };
    } catch (e) { console.warn("[cache] ai_explain_cache read failed:", (e as Error).message); }

    const prompt = `Analyze the file \`${data.path}\` (${data.language ?? "unknown"}).

Return Markdown with EXACTLY these sections in this order:

## Summary
One or two sentences describing what this file does.

## Key functions / exports
Bullet list, each item: \`name\` — one-line description.

## Logic flow
Short numbered steps describing how the file executes top-to-bottom.

## Patterns & dependencies
Notable patterns, external modules, and internal references.

\`\`\`${data.language ?? ""}
${data.code.slice(0, 30000)}
\`\`\``;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are Cortex, an expert code reader. Be precise and concise. Use Markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("Rate limit reached. Please wait a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted.");
      throw new Error(`AI error (${res.status}): ${txt.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (content) {
      try {
        await supabaseAdmin.from("ai_explain_cache").upsert([{
          id: cacheId,
          path: data.path,
          language: data.language ?? null,
          content_hash: hash,
          explanation: content,
          created_at: new Date().toISOString(),
        }]);
      } catch (e) { console.warn("[cache] ai_explain_cache write failed:", (e as Error).message); }
    }
    return { content, cached: false };
  });