import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const modeEnum = z.enum(["general", "explain", "brainstorm", "draft", "plan", "summarize"]);
const lengthEnum = z.enum(["concise", "balanced", "detailed"]);

const sourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  source: z.string().nullable(),
});
type Source = z.infer<typeof sourceSchema>;

const messageSchema = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  mode: z.string(),
  length: z.string(),
  webSearch: z.boolean(),
  sources: z.array(sourceSchema),
  followUps: z.array(z.string()),
  isError: z.boolean(),
  created_at: z.string(),
});

function parseJsonArray<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function toMessage(row: typeof schema.messages.$inferSelect) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    mode: row.mode,
    length: row.length,
    webSearch: row.webSearch,
    sources: parseJsonArray<Source[]>(row.sources, []),
    followUps: parseJsonArray<string[]>(row.followUps, []),
    isError: row.isError,
    created_at: row.createdAt.toISOString(),
  };
}

const MODE_SYSTEM: Record<string, string> = {
  general:
    "You are a helpful generalist AI assistant. Answer the user's request directly and helpfully, using what they said and the conversation history. Be accurate; if you are unsure, say so and explain what would settle it rather than guessing. Use clear structure only when it helps.",
  explain:
    "You are a helpful generalist AI assistant explaining something. Start with the core idea in plain language, define any technical terms as they appear, use one concrete example or analogy when it clarifies, and end with the most useful nuance or common misunderstanding. Do not assume background knowledge the user has not shown.",
  brainstorm:
    "You are a helpful generalist AI assistant brainstorming. Offer a varied set of distinct, concrete ideas grouped under short headings, not variations of one idea. Make each idea specific enough to act on, and close with a short note on which directions look strongest and why.",
  draft:
    "You are a helpful generalist AI assistant drafting text. Produce a polished, ready-to-use draft in the format the user asked for (or the most natural format if none was given). Match the tone implied by the request, keep it concrete, and do not add meta-commentary about the draft itself. If key details are missing, make a sensible choice visible in brackets like [name] rather than stopping.",
  plan:
    "You are a helpful generalist AI assistant making a plan. Break the goal into ordered, concrete steps with what each step involves, what it depends on, and a realistic sense of effort or timing where that can be judged. Flag decisions the user still needs to make and risks worth watching. Keep it practical, not generic.",
  summarize:
    "You are a helpful generalist AI assistant summarizing. Distill the material the user provided into the key points, preserving important numbers, names, and qualifications. Lead with the bottom line, then the supporting points, then anything unresolved or missing. Do not add facts that are not in the material.",
};

const LENGTH_GUIDANCE: Record<string, string> = {
  concise: "Keep the answer concise: roughly under 120 words unless the request clearly needs more. No filler.",
  balanced: "Give a balanced answer: thorough enough to be genuinely useful, focused enough to read quickly.",
  detailed: "Give a detailed answer: cover the topic comprehensively, with structure, examples, and edge cases where relevant.",
};

async function generateAnswer(
  ctx: Ctx,
  args: {
    history: { role: string; content: string }[];
    userContent: string;
    mode: string;
    length: string;
    webSearch: boolean;
  },
): Promise<{ answer: string; followUps: string[]; sources: Source[] }> {
  let sources: Source[] = [];
  let grounding = "";
  if (args.webSearch) {
    try {
      const raw = (await ctx.tool.web_search(args.userContent)) as unknown;
      const content = (raw as { content?: unknown })?.content ?? raw;
      const results = (content as { results?: unknown })?.results;
      const list = Array.isArray(results) ? results : [];
      const picked = list.slice(0, 5).map((r) => {
        const item = r as Record<string, unknown>;
        return {
          title: typeof item.title === "string" && item.title ? item.title : "Untitled source",
          url: typeof item.url === "string" ? item.url : null,
          source: typeof item.source === "string" ? item.source : null,
          snippet: typeof item.snippet === "string" ? item.snippet : "",
          published_at: typeof item.published_at === "string" ? item.published_at : null,
        };
      });
      sources = picked.map((p) => ({ title: p.title, url: p.url, source: p.source }));
      if (picked.length > 0) {
        grounding = `\n\nWEB SEARCH RESULTS for the user's question (use only what these establish; cite nothing by number, the sources are shown separately):\n${picked
          .map(
            (p, i) =>
              `${i + 1}. ${p.title}${p.source ? ` (${p.source})` : ""}${p.published_at ? ` — published ${p.published_at}` : ""}\n${p.snippet}`,
          )
          .join("\n")}\nIf these results do not establish an answer, say so plainly instead of guessing.`;
      } else {
        grounding =
          "\n\nThe user asked for a web search, but it returned no usable results. Say so plainly and offer what you can from general knowledge, clearly marked as such, rather than presenting guesses as searched facts.";
      }
    } catch {
      grounding =
        "\n\nThe user asked for a web search, but the search failed. Say so plainly and offer what you can from general knowledge, clearly marked as such, rather than presenting guesses as searched facts.";
      sources = [];
    }
  }

  const historyText = args.history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  const prompt = `${historyText ? `CONVERSATION SO FAR:\n${historyText}\n\n` : ""}LATEST USER REQUEST:\n${args.userContent}${grounding}`;
  const system = `${MODE_SYSTEM[args.mode] ?? MODE_SYSTEM.general}\n\n${LENGTH_GUIDANCE[args.length] ?? LENGTH_GUIDANCE.balanced}`;

  const result = await ctx.inference.complete(prompt, {
    system,
    schema: z.object({
      answer: z.string().min(1),
      followUps: z.array(z.string()).max(3).default([]),
    }),
  });
  return { answer: result.answer, followUps: result.followUps ?? [], sources };
}

export const Actions = {
  listConversations: defineAction({
    request: z.object({}),
    response: z.object({
      conversations: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          updated_at: z.string(),
          preview: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updatedAt), desc(schema.conversations.id));
      const out: { id: number; title: string; updated_at: string; preview: string }[] = [];
      for (const row of rows) {
        const last = await db
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, row.id))
          .orderBy(desc(schema.messages.id))
          .limit(1);
        const first = last[0];
        out.push({
          id: row.id,
          title: row.title,
          updated_at: row.updatedAt.toISOString(),
          preview: first ? first.content.slice(0, 90) : "",
        });
      }
      return { conversations: out };
    },
  }),

  getConversation: defineAction({
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({
      conversation: z.object({ id: z.number(), title: z.string(), updated_at: z.string() }).nullable(),
      messages: z.array(messageSchema),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.id, args.conversationId))
        .limit(1);
      const conv = rows[0];
      if (!conv) return { conversation: null, messages: [] };
      const msgs = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, args.conversationId))
        .orderBy(asc(schema.messages.id));
      return {
        conversation: { id: conv.id, title: conv.title, updated_at: conv.updatedAt.toISOString() },
        messages: msgs.map(toMessage),
      };
    },
  }),

  sendMessage: defineAction({
    request: z.object({
      conversationId: z.number().int().positive().nullable(),
      content: z.string().trim().min(1).max(8000),
      mode: modeEnum.default("general"),
      length: lengthEnum.default("balanced"),
      webSearch: z.boolean().default(false),
    }),
    response: z.object({
      ok: z.boolean(),
      conversationId: z.number(),
      assistantMessageId: z.number().nullable(),
      error: z.string().nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let conversationId = args.conversationId;
      let isNew = false;
      if (conversationId === null) {
        const inserted = await db
          .insert(schema.conversations)
          .values({ title: args.content.slice(0, 60) })
          .returning({ id: schema.conversations.id });
        const row = inserted[0];
        if (!row) throw new Error("sendMessage: could not create conversation");
        conversationId = row.id;
        isNew = true;
      } else {
        const existing = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        if (!existing[0]) {
          return { ok: false, conversationId, assistantMessageId: null, error: "That conversation no longer exists. Start a new chat." };
        }
      }

      await db.insert(schema.messages).values({
        conversationId,
        role: "user",
        content: args.content,
        mode: args.mode,
        length: args.length,
        webSearch: args.webSearch,
      });

      const prior = await db
        .select()
        .from(schema.messages)
        .where(
          and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.isError, false)),
        )
        .orderBy(asc(schema.messages.id));
      const history = prior.slice(-12).map((m) => ({ role: m.role, content: m.content }));

      try {
        const { answer, followUps, sources } = await generateAnswer(ctx, {
          history: history.slice(0, -1),
          userContent: args.content,
          mode: args.mode,
          length: args.length,
          webSearch: args.webSearch,
        });
        const inserted = await db
          .insert(schema.messages)
          .values({
            conversationId,
            role: "assistant",
            content: answer,
            mode: args.mode,
            length: args.length,
            webSearch: args.webSearch,
            sources: JSON.stringify(sources),
            followUps: JSON.stringify(followUps.slice(0, 3)),
          })
          .returning({ id: schema.messages.id });
        await db
          .update(schema.conversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));

        if (isNew) {
          try {
            const titled = await ctx.inference.complete(
              `Give a short conversation title, 6 words or fewer, no punctuation at the end, for this first exchange.\nUser: ${args.content}\nAssistant: ${answer.slice(0, 500)}`,
              { schema: z.object({ title: z.string().min(1).max(60) }) },
            );
            const title = titled.title.trim();
            if (title) {
              await db
                .update(schema.conversations)
                .set({ title })
                .where(eq(schema.conversations.id, conversationId));
            }
          } catch {
            // Keep the fallback title; titles are editable in the UI.
          }
        }

        ctx.invalidateQueries();
        return { ok: true, conversationId, assistantMessageId: inserted[0]?.id ?? null, error: null };
      } catch {
        await db.insert(schema.messages).values({
          conversationId,
          role: "assistant",
          content: "I couldn't generate an answer just now. Your message is saved — try again.",
          mode: args.mode,
          length: args.length,
          webSearch: args.webSearch,
          isError: true,
        });
        await db
          .update(schema.conversations)
          .set({ updatedAt: new Date() })
          .where(eq(schema.conversations.id, conversationId));
        ctx.invalidateQueries();
        return { ok: true, conversationId, assistantMessageId: null, error: "generation_failed" };
      }
    },
  }),

  regenerateMessage: defineAction({
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), error: z.string().nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const msgs = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, args.conversationId))
        .orderBy(asc(schema.messages.id));
      const lastUser = [...msgs].reverse().find((m) => m.role === "user");
      if (!lastUser) return { ok: false, error: "No message to regenerate from." };
      // Drop trailing assistant messages after the last user message (the failed/stale answer).
      const userIdx = msgs.findIndex((m) => m.id === lastUser.id);
      for (const m of msgs.slice(userIdx + 1)) {
        await db.delete(schema.messages).where(eq(schema.messages.id, m.id));
      }
      const history = msgs
        .slice(0, userIdx)
        .filter((m) => !m.isError)
        .slice(-11)
        .map((m) => ({ role: m.role, content: m.content }));
      try {
        const { answer, followUps, sources } = await generateAnswer(ctx, {
          history,
          userContent: lastUser.content,
          mode: lastUser.mode,
          length: lastUser.length,
          webSearch: lastUser.webSearch,
        });
        await db.insert(schema.messages).values({
          conversationId: args.conversationId,
          role: "assistant",
          content: answer,
          mode: lastUser.mode,
          length: lastUser.length,
          webSearch: lastUser.webSearch,
          sources: JSON.stringify(sources),
          followUps: JSON.stringify(followUps.slice(0, 3)),
        });
      } catch {
        await db.insert(schema.messages).values({
          conversationId: args.conversationId,
          role: "assistant",
          content: "I couldn't generate an answer just now. Your message is saved — try again.",
          mode: lastUser.mode,
          length: lastUser.length,
          webSearch: lastUser.webSearch,
          isError: true,
        });
      }
      await db
        .update(schema.conversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return { ok: true, error: null };
    },
  }),

  renameConversation: defineAction({
    request: z.object({ conversationId: z.number().int().positive(), title: z.string().trim().min(1).max(80) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.conversations)
        .set({ title: args.title })
        .where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteConversation: defineAction({
    request: z.object({ conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, args.conversationId));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, args.conversationId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
