import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type Mode = "general" | "explain" | "brainstorm" | "draft" | "plan" | "summarize";
type Length = "concise" | "balanced" | "detailed";
type Conversation = ApiResponse<typeof api, "listConversations">["conversations"][number];
type Message = ApiResponse<typeof api, "getConversation">["messages"][number];

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "general", label: "Ask anything", hint: "A straight answer" },
  { id: "explain", label: "Explain it", hint: "Plain language, with an example" },
  { id: "brainstorm", label: "Brainstorm", hint: "Varied, concrete ideas" },
  { id: "draft", label: "Draft it", hint: "Ready-to-use wording" },
  { id: "plan", label: "Plan it", hint: "Ordered, practical steps" },
  { id: "summarize", label: "Summarize", hint: "Bottom line first" },
];

const STARTERS: { label: string; prompt: string; mode: Mode }[] = [
  { label: "Explain how interest rates affect house prices", prompt: "Explain how interest rates affect house prices, in plain language.", mode: "explain" },
  { label: "Brainstorm a small weekend project", prompt: "Brainstorm ideas for a small, satisfying weekend project I can finish in a day or two.", mode: "brainstorm" },
  { label: "Draft a polite follow-up email", prompt: "Draft a short, polite follow-up email to someone who hasn't replied to my proposal from last week.", mode: "draft" },
  { label: "Plan learning to cook more at home", prompt: "Make me a practical 4-week plan for cooking at home more often, starting from almost no routine.", mode: "plan" },
  { label: "Give me a morning routine for busy days", prompt: "Suggest a realistic 20-minute morning routine for busy weekdays.", mode: "general" },
  { label: "Help me decide: repair or replace?", prompt: "Help me think through whether to repair my aging laptop or replace it. What questions should I ask myself?", mode: "general" },
];

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    const token = match[0];
    const idx = match.index;
    if (idx > last) parts.push(text.slice(last, idx));
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyPrefix}-${i}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={`${keyPrefix}-${i}`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={`${keyPrefix}-${i}`} className="rounded bg-[var(--surface-alt)] px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (m && m[1] && m[2]) {
        parts.push(
          <a key={`${keyPrefix}-${i}`} href={m[2]} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] underline underline-offset-2">
            {m[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    }
    last = idx + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const segments = content.split(/```/);
  segments.forEach((segment, segIdx) => {
    if (segIdx % 2 === 1) {
      const code = segment.replace(/^\w+\n/, "");
      blocks.push(
        <pre key={`code-${segIdx}`} className="overflow-x-auto rounded-lg bg-[var(--surface-alt)] p-3 text-sm leading-relaxed">
          <code>{code.replace(/^\n+|\n+$/g, "")}</code>
        </pre>,
      );
      return;
    }
    const paragraphs = segment.split(/\n\s*\n/);
    paragraphs.forEach((para, pIdx) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      const key = `b-${segIdx}-${pIdx}`;
      const lines = trimmed.split("\n");
      const first = lines[0] ?? "";
      if (first.startsWith("### ")) {
        blocks.push(<h3 key={key} className="font-serif text-lg font-semibold">{renderInline(first.slice(4), key)}</h3>);
        const rest = lines.slice(1).join("\n").trim();
        if (rest) blocks.push(<p key={`${key}-r`} className="whitespace-pre-wrap">{renderInline(rest, `${key}-r`)}</p>);
        return;
      }
      if (first.startsWith("## ")) {
        blocks.push(<h3 key={key} className="font-serif text-xl font-semibold">{renderInline(first.slice(3), key)}</h3>);
        const rest = lines.slice(1).join("\n").trim();
        if (rest) blocks.push(<p key={`${key}-r`} className="whitespace-pre-wrap">{renderInline(rest, `${key}-r`)}</p>);
        return;
      }
      if (first.startsWith("# ")) {
        blocks.push(<h3 key={key} className="font-serif text-xl font-semibold">{renderInline(first.slice(2), key)}</h3>);
        return;
      }
      if (lines.every((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))) {
        const isOrdered = /^\d+[.)]\s+/.test(first);
        const items = lines.map((l) => l.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""));
        blocks.push(
          isOrdered ? (
            <ol key={key} className="list-decimal space-y-1.5 pl-5">
              {items.map((item, i) => (
                <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
              ))}
            </ol>
          ) : (
            <ul key={key} className="list-disc space-y-1.5 pl-5">
              {items.map((item, i) => (
                <li key={i}>{renderInline(item, `${key}-${i}`)}</li>
              ))}
            </ul>
          ),
        );
        return;
      }
      blocks.push(
        <p key={key} className="whitespace-pre-wrap">
          {renderInline(trimmed, key)}
        </p>,
      );
    });
  });
  return <div className="space-y-3">{blocks}</div>;
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("general");
  const [length, setLength] = useState<Length>("balanced");
  const [webSearch, setWebSearch] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.listConversations({}),
  });
  const threadQuery = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => api.getConversation({ conversationId: selectedId ?? 0 }),
    enabled: selectedId !== null,
  });

  const messages: Message[] = threadQuery.data?.messages ?? [];
  const currentTitle = threadQuery.data?.conversation?.title ?? "New chat";

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    if (selectedId !== null) await queryClient.invalidateQueries({ queryKey: ["conversation", selectedId] });
  };

  const sendMutation = useMutation({
    mutationFn: (args: { conversationId: number | null; content: string; mode: Mode; length: Length; webSearch: boolean }) =>
      api.sendMessage(args),
    onSuccess: async (res) => {
      setPendingText(null);
      if (!res.ok) {
        setSendError(res.error ?? "Something went wrong.");
        return;
      }
      setSelectedId(res.conversationId);
      await refresh();
    },
    onError: () => {
      setPendingText(null);
      setSendError("Your message could not be sent. Check your connection and try again.");
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (conversationId: number) => api.regenerateMessage({ conversationId }),
    onSuccess: () => refresh(),
  });

  const deleteMutation = useMutation({
    mutationFn: (conversationId: number) => api.deleteConversation({ conversationId }),
    onSuccess: async () => {
      setSelectedId(null);
      setConfirmDelete(false);
      setDrawerOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: (args: { conversationId: number; title: string }) => api.renameConversation(args),
    onSuccess: async () => {
      setEditingTitle(false);
      await refresh();
    },
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingText, threadQuery.isPending]);

  useEffect(() => {
    setConfirmDelete(false);
    setEditingTitle(false);
    setSendError(null);
  }, [selectedId]);

  function submit(text: string, useMode: Mode, useWeb: boolean) {
    const content = text.trim();
    if (!content || sendMutation.isPending) return;
    setSendError(null);
    setDraft("");
    setPendingText(content);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    sendMutation.mutate({ conversationId: selectedId, content, mode: useMode, length, webSearch: useWeb });
  }

  function handleStarter(starter: (typeof STARTERS)[number]) {
    setMode(starter.mode);
    submit(starter.prompt, starter.mode, false);
  }

  async function copyText(id: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1800);
    } catch {
      // Clipboard unavailable; the text remains selectable in the thread.
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.isError);
  const showEmpty = selectedId === null || (!threadQuery.isPending && messages.length === 0 && !pendingText);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="font-serif text-lg font-semibold">Chats</span>
        <button
          type="button"
          aria-label="Start a new chat"
          className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
          onClick={() => {
            setSelectedId(null);
            setDrawerOpen(false);
            setDraft("");
          }}
        >
          New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {conversationsQuery.isPending && <p className="px-2 py-3 text-sm text-[var(--dim)]">Loading chats…</p>}
        {conversationsQuery.data?.conversations.length === 0 && (
          <p className="px-2 py-3 text-sm leading-relaxed text-[var(--dim)]">
            No chats yet. Your conversations will appear here once you ask something.
          </p>
        )}
        {conversationsQuery.data?.conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={`Open chat: ${c.title}`}
            aria-current={c.id === selectedId}
            className={`mb-1 block w-full rounded-lg px-3 py-2.5 text-left ${
              c.id === selectedId ? "bg-[var(--surface-alt)]" : "hover:bg-[var(--surface-alt)]"
            }`}
            onClick={() => {
              setSelectedId(c.id);
              setDrawerOpen(false);
            }}
          >
            <span className="block truncate text-sm font-medium">{c.title}</span>
            <span className="mt-0.5 block truncate text-xs text-[var(--dim)]">
              {c.preview || "—"}
            </span>
            <span className="mt-0.5 block text-xs text-[var(--dim)]">
              {new Date(c.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" · "}
              {new Date(c.updated_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <div className="mx-auto flex h-dvh max-w-6xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-[var(--border)] md:block">{sidebar}</aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Chat list">
            <button type="button" aria-label="Close chat list" className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-[var(--bg)] shadow-xl">{sidebar}</div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Thread header */}
          <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 pt-safe">
            <button
              type="button"
              aria-label="Open chat list"
              className="rounded-lg px-2 py-1.5 text-sm font-medium md:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              ☰ Chats
            </button>
            {selectedId !== null && editingTitle ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = titleDraft.trim();
                  if (t && selectedId !== null) renameMutation.mutate({ conversationId: selectedId, title: t });
                }}
              >
                <input
                  aria-label="Chat title"
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={80}
                />
                <button type="submit" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white">
                  Save
                </button>
                <button type="button" className="rounded-lg px-2 py-1.5 text-sm" onClick={() => setEditingTitle(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <h1 className="min-w-0 flex-1 truncate font-serif text-base font-semibold sm:text-lg">{currentTitle}</h1>
                {selectedId !== null && (
                  <>
                    <button
                      type="button"
                      aria-label="Rename chat"
                      className="rounded-lg px-2 py-1.5 text-sm text-[var(--dim)]"
                      onClick={() => {
                        setTitleDraft(currentTitle);
                        setEditingTitle(true);
                      }}
                    >
                      Rename
                    </button>
                    {confirmDelete ? (
                      <>
                        <button
                          type="button"
                          aria-label="Confirm delete chat"
                          className="rounded-lg bg-red-700 px-2 py-1.5 text-sm font-medium text-white"
                          disabled={deleteMutation.isPending}
                          onClick={() => selectedId !== null && deleteMutation.mutate(selectedId)}
                        >
                          Confirm delete
                        </button>
                        <button type="button" aria-label="Cancel delete" className="rounded-lg px-2 py-1.5 text-sm" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label="Delete chat"
                        className="rounded-lg px-2 py-1.5 text-sm text-[var(--dim)]"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  aria-label="Start a new chat"
                  className="hidden rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white sm:block"
                  onClick={() => {
                    setSelectedId(null);
                    setDraft("");
                  }}
                >
                  New chat
                </button>
              </>
            )}
          </header>

          {/* Thread */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {showEmpty ? (
              <div className="mx-auto max-w-2xl px-5 pt-10 pb-6 sm:pt-16">
                <p className="font-serif text-3xl leading-tight font-semibold sm:text-4xl">What can I help with?</p>
                <p className="mt-3 max-w-xl text-base leading-relaxed text-[var(--dim)]">
                  Ask a question, get something explained, brainstorm ideas, draft a message, or make a plan. Turn on web search when the answer needs current information.
                </p>
                <div className="mt-8 grid gap-2 sm:grid-cols-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left hover:border-[var(--accent)]"
                      onClick={() => handleStarter(s)}
                    >
                      <span className="block text-sm font-medium">{s.label}</span>
                      <span className="mt-0.5 block text-xs text-[var(--dim)]">{MODES.find((m) => m.id === s.mode)?.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-6">
                {threadQuery.isPending && <p className="text-sm text-[var(--dim)]">Loading conversation…</p>}
                {messages.map((m) => {
                  const isUser = m.role === "user";
                  const isLastAssistant = lastAssistant?.id === m.id;
                  return (
                    <div key={m.id} className={isUser ? "flex justify-end" : ""}>
                      <div className={isUser ? "max-w-[85%] rounded-2xl bg-[var(--accent-soft)] px-4 py-3" : "max-w-full"}>
                        {isUser ? (
                          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
                        ) : (
                          <>
                            {m.isError ? (
                              <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[15px] leading-relaxed text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                                {m.content}
                              </p>
                            ) : (
                              <div className="text-[15px] leading-relaxed sm:text-base">
                                <Markdown content={m.content} />
                              </div>
                            )}
                            {m.webSearch && m.sources.length > 0 && (
                              <div className="mt-3 border-t border-[var(--border)] pt-2">
                                <p className="text-xs font-medium tracking-wide text-[var(--dim)] uppercase">Sources</p>
                                <ul className="mt-1.5 space-y-1">
                                  {m.sources.map((s, i) => (
                                    <li key={i} className="text-sm">
                                      {s.url ? (
                                        <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--accent-text)] underline underline-offset-2">
                                          {s.title}
                                        </a>
                                      ) : (
                                        <span>{s.title}</span>
                                      )}
                                      {s.source && <span className="text-[var(--dim)]"> · {s.source}</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {!m.isError && (
                                <button
                                  type="button"
                                  aria-label="Copy answer"
                                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs"
                                  onClick={() => copyText(m.id, m.content)}
                                >
                                  {copiedId === m.id ? "Copied" : "Copy"}
                                </button>
                              )}
                              {isLastAssistant && selectedId !== null && (
                                <button
                                  type="button"
                                  aria-label="Regenerate answer"
                                  className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs"
                                  disabled={regenerateMutation.isPending}
                                  onClick={() => regenerateMutation.mutate(selectedId)}
                                >
                                  {regenerateMutation.isPending ? "Regenerating…" : "Regenerate"}
                                </button>
                              )}
                            </div>
                            {isLastAssistant && m.followUps.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {m.followUps.map((f) => (
                                  <button
                                    key={f}
                                    type="button"
                                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-left text-sm"
                                    onClick={() => submit(f, mode, false)}
                                  >
                                    {f}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {pendingText && (
                  <>
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl bg-[var(--accent-soft)] px-4 py-3">
                        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{pendingText}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--dim)]" aria-label="Thinking">
                      <span className="flex gap-1" aria-hidden="true">
                        <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--dim)]" />
                        <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--dim)]" />
                        <span className="thinking-dot inline-block h-2 w-2 rounded-full bg-[var(--dim)]" />
                      </span>
                      <span className="text-sm">Thinking…</span>
                    </div>
                  </>
                )}
                {sendError && (
                  <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                    {sendError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-[var(--border)] bg-[var(--bg)] px-3 pt-3 pb-3 pb-safe sm:px-5">
            <div className="mx-auto max-w-2xl">
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Response style">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={mode === m.id}
                    title={m.hint}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      mode === m.id ? "bg-[var(--text)] text-[var(--bg)]" : "border border-[var(--border)] bg-[var(--surface)]"
                    }`}
                    onClick={() => setMode(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(draft, mode, webSearch);
                }}
              >
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 focus-within:border-[var(--accent)]">
                  <textarea
                    ref={textareaRef}
                    aria-label="Ask the assistant"
                    placeholder="Ask anything…"
                    rows={1}
                    value={draft}
                    disabled={sendMutation.isPending}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit(draft, mode, webSearch);
                      }
                    }}
                    className="max-h-40 w-full resize-none bg-transparent px-2 pt-1.5 text-base leading-relaxed outline-none placeholder:text-[var(--dim)]"
                  />
                  <div className="flex flex-nowrap items-center justify-between gap-1 px-1 pt-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        aria-pressed={webSearch}
                        aria-label="Search the web for this question"
                        className={`flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1.5 text-sm whitespace-nowrap ${webSearch ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "text-[var(--dim)]"}`}
                        onClick={() => setWebSearch((v) => !v)}
                      >
                        <span aria-hidden="true" className={`inline-block h-4 w-7 shrink-0 rounded-full p-0.5 ${webSearch ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}>
                          <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${webSearch ? "translate-x-3" : ""}`} />
                        </span>
                        Web search
                      </button>
                      <div className="flex shrink-0 rounded-full border border-[var(--border)]" role="group" aria-label="Answer length">
                        {(["concise", "balanced", "detailed"] as Length[]).map((l) => (
                          <button
                            key={l}
                            type="button"
                            aria-pressed={length === l}
                            className={`px-2 py-1.5 text-[11px] capitalize ${length === l ? "rounded-full bg-[var(--surface-alt)] font-medium" : "text-[var(--dim)]"}`}
                            onClick={() => setLength(l)}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="submit"
                      aria-label="Send message"
                      disabled={!draft.trim() || sendMutation.isPending}
                      className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {sendMutation.isPending ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </form>
              <p className="mt-2 text-center text-xs text-[var(--dim)]">
                {webSearch ? "Web search is on — answers will cite the sources found." : "Answers are AI-generated. Check important facts before relying on them."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
