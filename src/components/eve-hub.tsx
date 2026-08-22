"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
} from "eve/react";
import { useEveAgent } from "eve/react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUp,
  AtSign,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  CloudOff,
  Code2,
  ExternalLink,
  FileText,
  Globe2,
  GraduationCap,
  History,
  Laptop,
  LogOut,
  Mail,
  Menu,
  MessageSquareText,
  MonitorUp,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import type { HubIdentity } from "@/lib/hub-server";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type CapabilityName =
  | "webSearch"
  | "screenContext"
  | "computerUse"
  | "browserUse"
  | "email";

type Capabilities = Record<CapabilityName, boolean>;

interface ConversationItem {
  readonly lastMessage?: string;
  readonly sessionId: string;
  readonly status: "active" | "completed" | "failed";
  readonly title: string;
  readonly updatedAt: string;
}

interface TaskItem {
  readonly checkpointId?: string;
  readonly error?: string;
  readonly sessionId: string;
  readonly status: "cancelled" | "completed" | "failed" | "running";
  readonly turnId: string;
  readonly updatedAt: string;
}

interface TaskStep {
  readonly expectedEvidence?: string;
  readonly instruction: string;
  readonly tool?: string;
}

interface TaskExample {
  readonly _id: string;
  readonly goal: string;
  readonly steps: readonly TaskStep[];
  readonly title: string;
  readonly triggers: readonly string[];
  readonly updatedAt: string;
}

interface InputResponse {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
}

const INITIAL_CAPABILITIES: Capabilities = {
  browserUse: false,
  computerUse: false,
  email: false,
  screenContext: false,
  webSearch: false,
};

const CAPABILITY_OPTIONS: readonly {
  readonly description: string;
  readonly icon: typeof Search;
  readonly key: CapabilityName;
  readonly label: string;
}[] = [
  {
    description: "Search through the local SearXNG gateway",
    icon: Search,
    key: "webSearch",
    label: "Web",
  },
  {
    description: "Let Eve inspect the current Mac display",
    icon: MonitorUp,
    key: "screenContext",
    label: "Screen",
  },
  {
    description: "Allow approved mouse and keyboard actions",
    icon: MousePointer2,
    key: "computerUse",
    label: "Control",
  },
  {
    description: "Use the isolated computer-use browser",
    icon: Globe2,
    key: "browserUse",
    label: "Browser",
  },
  {
    description: "Search connected enterprise email",
    icon: Mail,
    key: "email",
    label: "Email",
  },
];

const STARTERS = [
  {
    icon: Mail,
    title: "Triage my customer escalation",
    prompt:
      "Find the latest customer escalation email, summarize the situation, and draft a response. Do not send anything without my approval.",
  },
  {
    icon: Globe2,
    title: "Research a live market question",
    prompt:
      "Research the latest developments affecting our market, cite the evidence, and save a concise decision memo in the task workspace.",
  },
  {
    icon: Laptop,
    title: "Work from what is on screen",
    prompt:
      "Look at my screen, explain what I am working on, and suggest the next three concrete actions. Do not interact with the computer yet.",
  },
] as const;

export function EveHub({
  identity,
  initialSessionId,
}: {
  readonly identity: HubIdentity;
  readonly initialSessionId?: string;
}) {
  const [view, setView] = useState<"chat" | "teach">("chat");
  const [capabilities, setCapabilities] =
    useState<Capabilities>(INITIAL_CAPABILITIES);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<readonly ConversationItem[]>([]);
  const [tasks, setTasks] = useState<readonly TaskItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [error, setError] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/hub/conversations", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        conversations: readonly ConversationItem[];
      };
      setConversations(body.conversations);
    } catch {
      // The agent remains usable while MongoDB reconnects.
    }
  }, []);

  const agent = useEveAgent({
    initialSession: initialSessionId
      ? { sessionId: initialSessionId, streamIndex: 0 }
      : undefined,
    resume: initialSessionId !== undefined,
    onSessionChange(session) {
      if (initialSessionId === undefined && session !== undefined) {
        window.history.replaceState(
          window.history.state,
          "",
          `/s/${encodeURIComponent(session.sessionId)}`,
        );
      }
      void refreshConversations();
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const activeSessionId = initialSessionId ?? agent.session?.sessionId;
  const isEmpty = agent.data.messages.length === 0;

  const refreshTasks = useCallback(async () => {
    if (!activeSessionId) {
      setTasks([]);
      return;
    }
    try {
      const response = await fetch(
        `/api/hub/tasks?sessionId=${encodeURIComponent(activeSessionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const body = (await response.json()) as { tasks: readonly TaskItem[] };
      setTasks(body.tasks);
    } catch {
      // The event stream remains the primary source while this panel reconnects.
    }
  }, [activeSessionId]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshConversations(), 0);
    return () => window.clearTimeout(initial);
  }, [refreshConversations]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshTasks(), 0);
    const timer = window.setInterval(() => {
      void refreshTasks();
      void refreshConversations();
    }, isBusy ? 2_500 : 8_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [isBusy, refreshConversations, refreshTasks]);

  useEffect(() => {
    const focusComposer = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("chat");
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, []);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message) return;
      setError(undefined);
      setInput("");
      try {
        await agent.send(message, {
          clientContext: {
            eveHubCapabilities: capabilities,
            surface: "web",
          },
          ...(isBusy ? { turnPolicy: "steer" as const } : {}),
        });
      } catch (sendError) {
        setError(
          sendError instanceof Error ? sendError.message : "Eve could not start that task.",
        );
      }
    },
    [agent, capabilities, isBusy],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  }

  const conversationTitle =
    conversations.find((item) => item.sessionId === activeSessionId)?.title ??
    (activeSessionId ? "Resumed workspace" : "New conversation");

  return (
    <main className="eve-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <ConversationSidebar
        activeSessionId={activeSessionId}
        conversations={conversations}
        identity={identity}
        onClose={() => setSidebarOpen(false)}
        onSelectView={(nextView) => {
          setView(nextView);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
        view={view}
      />

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              aria-label="Open navigation"
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Menu size={18} />
            </button>
            <div>
              <div className="topbar-eyebrow">
                <span className="live-dot" />
                Local on GB10
              </div>
              <h1>{view === "chat" ? conversationTitle : "Teach Eve"}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="private-badge">
              <CloudOff size={14} />
              Private by default
            </div>
            {view === "chat" ? (
              <button
                aria-label={activityOpen ? "Hide activity" : "Show activity"}
                className={`icon-button ${activityOpen ? "active" : ""}`}
                onClick={() => setActivityOpen((current) => !current)}
                type="button"
              >
                {activityOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            ) : null}
          </div>
        </header>

        {view === "chat" ? (
          <div className={`chat-layout ${activityOpen ? "with-activity" : ""}`}>
            <section className="chat-main">
              <div className="message-scroll">
                {isEmpty ? (
                  <Welcome onStarter={(prompt) => void send(prompt)} />
                ) : (
                  <div className="messages">
                    {agent.data.messages.map((message, index) => (
                      <MessageView
                        busy={isBusy}
                        isLatest={index === agent.data.messages.length - 1}
                        key={message.id}
                        message={message}
                        onRespond={(responses) => agent.respond(responses)}
                      />
                    ))}
                    {isBusy && <Thinking />}
                    <div aria-hidden className="scroll-spacer" />
                  </div>
                )}
              </div>

              <div className="composer-zone">
                {error || agent.error ? (
                  <div className="composer-error" role="alert">
                    <XCircle size={14} />
                    {error ?? agent.error?.message}
                  </div>
                ) : null}
                <form className="composer" onSubmit={submit}>
                  <textarea
                    aria-label="Message Eve"
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={composerKeyDown}
                    placeholder="Ask Eve to research, reason, or take action…"
                    ref={textareaRef}
                    rows={1}
                    value={input}
                  />
                  <div className="composer-bottom">
                    <div className="capability-list">
                      {CAPABILITY_OPTIONS.map((option) => (
                        <CapabilityToggle
                          enabled={capabilities[option.key]}
                          key={option.key}
                          onChange={() =>
                            setCapabilities((current) => ({
                              ...current,
                              [option.key]: !current[option.key],
                            }))
                          }
                          option={option}
                        />
                      ))}
                    </div>
                    {isBusy ? (
                      <button
                        aria-label="Stop current task"
                        className="send-button stop"
                        onClick={() => void agent.cancel()}
                        type="button"
                      >
                        <CircleStop size={17} />
                      </button>
                    ) : (
                      <button
                        aria-label="Send message"
                        className="send-button"
                        disabled={!input.trim()}
                        type="submit"
                      >
                        <ArrowUp size={18} />
                      </button>
                    )}
                  </div>
                </form>
                <p className="composer-note">
                  Capabilities apply to this turn only · actions still require approval
                  <span>⌘K to focus</span>
                </p>
              </div>
            </section>
            {activityOpen ? (
              <ActivityRail
                activeSessionId={activeSessionId}
                busy={isBusy}
                events={agent.events}
                onRefresh={() => void refreshTasks()}
                tasks={tasks}
              />
            ) : null}
          </div>
        ) : (
          <TeachWorkspace />
        )}
      </section>
    </main>
  );
}

function ConversationSidebar({
  activeSessionId,
  conversations,
  identity,
  onClose,
  onSelectView,
  open,
  view,
}: {
  readonly activeSessionId?: string;
  readonly conversations: readonly ConversationItem[];
  readonly identity: HubIdentity;
  readonly onClose: () => void;
  readonly onSelectView: (view: "chat" | "teach") => void;
  readonly open: boolean;
  readonly view: "chat" | "teach";
}) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.reload();
  }
  const initials = identity.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <>
      {open ? <button aria-label="Close navigation" className="sidebar-scrim" onClick={onClose} /> : null}
      <aside className={`sidebar ${open ? "mobile-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div className="brand-copy">
            <strong>eve</strong>
            <span>Enterprise intelligence</span>
          </div>
          <button aria-label="Close navigation" className="icon-button sidebar-close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <button className="new-chat" onClick={() => router.push("/")} type="button">
          <Plus size={17} />
          New conversation
          <kbd>⌘K</kbd>
        </button>

        <nav className="primary-nav" aria-label="Workspace">
          <button
            className={view === "chat" ? "selected" : ""}
            onClick={() => onSelectView("chat")}
            type="button"
          >
            <MessageSquareText size={17} />
            Conversations
          </button>
          <button
            className={view === "teach" ? "selected" : ""}
            onClick={() => onSelectView("teach")}
            type="button"
          >
            <GraduationCap size={17} />
            Teach Eve
            <span className="nav-new">New</span>
          </button>
        </nav>

        <div className="history-heading">
          <span>Recent</span>
          <History size={14} />
        </div>
        <div className="history-list">
          {conversations.length === 0 ? (
            <p className="empty-history">Your durable conversations will appear here.</p>
          ) : (
            conversations.map((conversation) => (
              <a
                className={conversation.sessionId === activeSessionId ? "active" : ""}
                href={`/s/${encodeURIComponent(conversation.sessionId)}`}
                key={conversation.sessionId}
              >
                <span className={`history-status ${conversation.status}`} />
                <span>
                  <strong>{conversation.title}</strong>
                  <small>{relativeTime(conversation.updatedAt)}</small>
                </span>
              </a>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="node-card">
            <div className="node-icon">
              <Zap size={16} />
            </div>
            <div>
              <strong>GB10 · Online</strong>
              <span>Qwen · local inference</span>
            </div>
            <span className="node-pulse" />
          </div>
          <button className="profile-row" onClick={() => void signOut()} title="Sign out" type="button">
            <div className="avatar">{initials || "E"}</div>
            <div>
              <strong>{identity.name}</strong>
              <span>{identity.role === "admin" ? "Admin" : "Member"} · private session</span>
            </div>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}

function Welcome({ onStarter }: { readonly onStarter: (prompt: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-orbit">
        <div className="welcome-mark">
          <Sparkles size={28} />
        </div>
      </div>
      <div>
        <p className="eyebrow">Your private enterprise agent</p>
        <h2>What are we working on?</h2>
        <p className="welcome-subtitle">
          Eve can reason over company knowledge, use your tools, and carry work across
          long-running sessions—without sending inference to the cloud.
        </p>
      </div>
      <div className="starter-grid">
        {STARTERS.map((starter) => {
          const Icon = starter.icon;
          return (
            <button key={starter.title} onClick={() => onStarter(starter.prompt)} type="button">
              <span><Icon size={17} /></span>
              <strong>{starter.title}</strong>
              <ArrowUp className="starter-arrow" size={15} />
            </button>
          );
        })}
      </div>
      <div className="privacy-line">
        <ShieldCheck size={15} />
        Local inference · MongoDB memory · isolated execution
      </div>
    </div>
  );
}

function CapabilityToggle({
  enabled,
  onChange,
  option,
}: {
  readonly enabled: boolean;
  readonly onChange: () => void;
  readonly option: (typeof CAPABILITY_OPTIONS)[number];
}) {
  const Icon = option.icon;
  return (
    <button
      aria-pressed={enabled}
      className={`capability ${enabled ? "enabled" : ""}`}
      onClick={onChange}
      title={option.description}
      type="button"
    >
      <Icon size={14} />
      <span>{option.label}</span>
      {enabled ? <span className="capability-dot" /> : null}
    </button>
  );
}

function MessageView({
  busy,
  isLatest,
  message,
  onRespond,
}: {
  readonly busy: boolean;
  readonly isLatest: boolean;
  readonly message: EveMessage;
  readonly onRespond: (responses: readonly InputResponse[]) => void | Promise<void>;
}) {
  const hasText = message.parts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  return (
    <article className={`message ${message.role}`}>
      <div className="message-avatar">
        {message.role === "assistant" ? <Sparkles size={15} /> : "You"}
      </div>
      <div className="message-body">
        <div className="message-author">
          {message.role === "assistant" ? "Eve" : "You"}
          {message.metadata?.optimistic ? <span>sending</span> : null}
        </div>
        {message.parts.map((part, index) => (
          <MessagePart
            canRespond={!busy}
            hideReasoning={message.role === "assistant" && hasText}
            key={partKey(part, index)}
            onRespond={onRespond}
            part={part}
            streaming={
              isLatest &&
              message.role === "assistant" &&
              message.metadata?.status === "streaming"
            }
          />
        ))}
      </div>
    </article>
  );
}

function MessagePart({
  canRespond,
  hideReasoning,
  onRespond,
  part,
  streaming,
}: {
  readonly canRespond: boolean;
  readonly hideReasoning: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly streaming: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <div className={`message-text ${streaming && part.state === "streaming" ? "streaming" : ""}`}>
          {part.text}
        </div>
      );
    case "reasoning":
      return hideReasoning ? null : (
        <details className="reasoning" open={part.state === "streaming"}>
          <summary><BrainCircuit size={14} /> Reasoning</summary>
          <div>{part.text}</div>
        </details>
      );
    case "file":
      return <FilePart part={part} />;
    case "authorization":
      return <AuthorizationPart part={part} />;
    case "dynamic-tool":
      return <ToolPart canRespond={canRespond} onRespond={onRespond} part={part} />;
  }
}

function FilePart({ part }: { readonly part: Extract<EveMessagePart, { type: "file" }> }) {
  const isImage = part.mediaType.startsWith("image/") && part.url;
  if (isImage) {
    return (
      <a className="image-attachment" href={part.url} rel="noreferrer" target="_blank">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={part.filename ?? "Agent output"} src={part.url} />
      </a>
    );
  }
  return (
    <a className="file-attachment" href={part.url} rel="noreferrer" target="_blank">
      <FileText size={17} />
      <span>{part.filename ?? "Attachment"}</span>
      <ExternalLink size={13} />
    </a>
  );
}

function AuthorizationPart({ part }: { readonly part: EveAuthorizationPart }) {
  const complete = part.state === "completed";
  const success = complete && part.outcome === "authorized";
  return (
    <div className={`authorization-card ${complete ? (success ? "success" : "failed") : ""}`}>
      <div className="tool-icon"><AtSign size={16} /></div>
      <div>
        <strong>{complete ? `${part.displayName} ${success ? "connected" : "not connected"}` : `Connect ${part.displayName}`}</strong>
        <p>{part.description}</p>
        {!complete && part.authorization?.url ? (
          <a href={part.authorization.url} rel="noreferrer" target="_blank">
            Continue securely <ExternalLink size={13} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  bash: "Run in sandbox",
  browser_action: "Use browser",
  browser_observe: "Inspect browser",
  capture_screen: "See screen",
  computer_action: "Control computer",
  grep: "Search workspace",
  read: "Read workspace",
  remember_convention: "Learn convention",
  search_email: "Search email",
  teach_task: "Learn task",
  web_search: "Search the web",
  write: "Write to workspace",
};

function ToolPart({
  canRespond,
  onRespond,
  part,
}: {
  readonly canRespond: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const [open, setOpen] = useState(part.state === "approval-requested");
  const request = part.toolMetadata?.eve?.inputRequest;
  const pending =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    part.state === "approval-responded";
  const successful = part.state === "output-available";
  const failed = part.state === "output-error" || part.state === "output-denied";
  return (
    <div className={`tool-card ${failed ? "failed" : successful ? "success" : ""}`}>
      <button className="tool-summary" onClick={() => setOpen((current) => !current)} type="button">
        <span className="tool-icon">
          {pending ? <RefreshCw className="spin" size={15} /> : successful ? <Check size={15} /> : failed ? <X size={15} /> : <TerminalSquare size={15} />}
        </span>
        <span className="tool-name">
          <strong>{TOOL_LABELS[part.toolName] ?? humanize(part.toolName)}</strong>
          <small>{toolStateLabel(part.state)}</small>
        </span>
        <ChevronDown className={open ? "rotated" : ""} size={15} />
      </button>
      {open ? (
        <div className="tool-detail">
          {request ? (
            <InputRequest
              canRespond={canRespond}
              onRespond={onRespond}
              request={request}
              responded={part.toolMetadata?.eve?.inputResponse}
            />
          ) : null}
          {part.input !== undefined ? (
            <div className="tool-block">
              <span>Input</span>
              <pre>{formatData(part.input)}</pre>
            </div>
          ) : null}
          {part.state === "output-available" ? (
            <div className="tool-block">
              <span>Result</span>
              <pre>{formatData(part.output)}</pre>
            </div>
          ) : null}
          {part.state === "output-error" ? <p className="tool-error">{part.errorText}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function InputRequest({
  canRespond,
  onRespond,
  request,
  responded,
}: {
  readonly canRespond: boolean;
  readonly onRespond: (responses: readonly InputResponse[]) => void | Promise<void>;
  readonly request: EveMessageInputRequest;
  readonly responded?: InputResponse;
}) {
  const [freeform, setFreeform] = useState("");
  if (responded) {
    const label = request.options?.find((option) => option.id === responded.optionId)?.label;
    return <div className="approval-resolved"><CheckCircle2 size={14} /> Responded: {label ?? responded.text ?? responded.optionId}</div>;
  }
  return (
    <div className="approval-request">
      <div>
        <ShieldCheck size={16} />
        <p><strong>Approval required</strong><span>{request.prompt}</span></p>
      </div>
      {request.allowFreeform || !request.options?.length ? (
        <input onChange={(event) => setFreeform(event.target.value)} placeholder="Your response" value={freeform} />
      ) : null}
      <div className="approval-actions">
        {request.options?.map((option) => (
          <button
            className={option.style === "danger" ? "danger" : option.style === "primary" ? "primary" : ""}
            disabled={!canRespond}
            key={option.id}
            onClick={() => void onRespond([{ optionId: option.id, requestId: request.requestId }])}
            type="button"
          >
            {option.label}
          </button>
        ))}
        {(request.allowFreeform || !request.options?.length) && freeform.trim() ? (
          <button
            className="primary"
            disabled={!canRespond}
            onClick={() => void onRespond([{ requestId: request.requestId, text: freeform.trim() }])}
            type="button"
          >
            Submit
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="thinking">
      <span /><span /><span />
      <p>Eve is working</p>
    </div>
  );
}

function ActivityRail({
  activeSessionId,
  busy,
  events,
  onRefresh,
  tasks,
}: {
  readonly activeSessionId?: string;
  readonly busy: boolean;
  readonly events: ReturnType<typeof useEveAgent>["events"];
  readonly onRefresh: () => void;
  readonly tasks: readonly TaskItem[];
}) {
  const recentEvents = useMemo(
    () =>
      [...events]
        .reverse()
        .filter((event) =>
          ["turn.started", "turn.completed", "turn.failed", "turn.cancelled", "tool.called", "tool.completed"].includes(event.type),
        )
        .slice(0, 8),
    [events],
  );
  const latestTask = tasks[0];
  return (
    <aside className="activity-rail">
      <div className="activity-header">
        <div><Activity size={16} /><strong>Activity</strong></div>
        <button aria-label="Refresh activity" className="icon-button" onClick={onRefresh} type="button"><RefreshCw size={14} /></button>
      </div>

      <div className="runtime-card">
        <div className="runtime-top">
          <span className={`runtime-icon ${busy ? "busy" : ""}`}><Bot size={17} /></span>
          <div><strong>{busy ? "Agent running" : "Agent ready"}</strong><small>Qwen · GB10 local</small></div>
          <span className={`status-pill ${busy ? "running" : "ready"}`}>{busy ? "Live" : "Ready"}</span>
        </div>
        <div className="runtime-path">
          <span>Eve</span><i>→</i><span>OpenShell</span><i>→</i><span>MongoDB</span>
        </div>
      </div>

      <section className="activity-section">
        <div className="section-title"><span>Durable task</span>{latestTask ? <small>{relativeTime(latestTask.updatedAt)}</small> : null}</div>
        {latestTask ? (
          <div className="task-card">
            <span className={`task-status ${latestTask.status}`}>
              {latestTask.status === "running" ? <RefreshCw className="spin" size={14} /> : latestTask.status === "completed" ? <Check size={14} /> : <X size={14} />}
            </span>
            <div><strong>{humanize(latestTask.status)}</strong><small>{shortId(latestTask.turnId)}</small></div>
            {latestTask.checkpointId ? <span className="checkpoint"><ShieldCheck size={12} /> saved</span> : null}
          </div>
        ) : (
          <div className="activity-empty"><Clock3 size={17} /><span>No task started yet</span></div>
        )}
      </section>

      <section className="activity-section event-section">
        <div className="section-title"><span>Event trail</span><small>{events.length} total</small></div>
        <div className="event-list">
          {recentEvents.length ? recentEvents.map((event, index) => (
            <div className="event-row" key={`${event.meta.id}:${index}`}>
              <span className="event-node" />
              <div><strong>{humanize(event.type)}</strong><small>{relativeTime(event.meta.at)}</small></div>
            </div>
          )) : <div className="activity-empty compact"><Activity size={15} /><span>Events will stream here</span></div>}
        </div>
      </section>

      <div className="survival-card">
        <ShieldCheck size={16} />
        <div><strong>Survives its sandbox</strong><span>{activeSessionId ? "History and workspace checkpoints persist in MongoDB. You can close this tab." : "Start a task to create a durable session and workspace."}</span></div>
      </div>
    </aside>
  );
}

function TeachWorkspace() {
  const [examples, setExamples] = useState<readonly TaskExample[]>([]);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [triggers, setTriggers] = useState("");
  const [steps, setSteps] = useState<readonly string[]>(["", ""]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [training, setTraining] = useState(false);

  const loadExamples = useCallback(async () => {
    const response = await fetch("/api/hub/task-examples", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { examples: readonly TaskExample[] };
    setExamples(body.examples);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadExamples(), 0);
    return () => window.clearTimeout(initial);
  }, [loadExamples]);

  async function saveExample(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanSteps = steps.map((step) => step.trim()).filter(Boolean);
    const cleanTriggers = triggers.split(",").map((trigger) => trigger.trim()).filter(Boolean);
    if (cleanSteps.length === 0 || cleanTriggers.length === 0) {
      setNotice("Add at least one trigger and one step.");
      return;
    }
    setSaving(true);
    setNotice(undefined);
    try {
      const response = await fetch("/api/hub/task-examples", {
        body: JSON.stringify({
          goal,
          steps: cleanSteps.map((instruction) => ({ instruction })),
          title,
          triggers: cleanTriggers,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the behavior.");
      setTitle("");
      setGoal("");
      setTriggers("");
      setSteps(["", ""]);
      setNotice("Behavior learned. Matching future tasks will retrieve this procedure from MongoDB.");
      await loadExamples();
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Could not save the behavior.");
    } finally {
      setSaving(false);
    }
  }

  async function previewTraining() {
    setTraining(true);
    setNotice(undefined);
    try {
      const response = await fetch("/api/hub/training-jobs", { method: "POST" });
      const body = (await response.json()) as {
        job?: { datasetRows: number; estimatedMinutes: number };
        note?: string;
      };
      if (!response.ok || !body.job) throw new Error("Could not create the preview.");
      setNotice(`LoRA preview created for ${body.job.datasetRows} examples (~${body.job.estimatedMinutes} min). ${body.note ?? ""}`);
    } catch (previewError) {
      setNotice(previewError instanceof Error ? previewError.message : "Could not create the preview.");
    } finally {
      setTraining(false);
    }
  }

  return (
    <div className="teach-scroll">
      <div className="teach-page">
        <section className="teach-hero">
          <div className="teach-hero-icon"><GraduationCap size={25} /></div>
          <div>
            <p className="eyebrow">Behavior memory</p>
            <h2>Teach Eve how your team works</h2>
            <p>Capture a real procedure once. Eve retrieves it for similar tasks and changes how it plans—not just what it knows.</p>
          </div>
          <div className="behavior-proof">
            <span><BookOpen size={15} /> Stored in MongoDB</span>
            <span><BrainCircuit size={15} /> Retrieved into behavior</span>
          </div>
        </section>

        {notice ? <div className="teach-notice"><Sparkles size={15} />{notice}</div> : null}

        <div className="teach-grid">
          <form className="teach-form panel" onSubmit={saveExample}>
            <div className="panel-heading">
              <div><span className="step-number">1</span><div><h3>Record a task</h3><p>Describe the outcome and your team’s proven process.</p></div></div>
            </div>
            <label>
              Task name
              <input minLength={3} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Triage a customer escalation" required value={title} />
            </label>
            <label>
              Desired outcome
              <textarea minLength={10} onChange={(event) => setGoal(event.target.value)} placeholder="What does done look like? Include quality and safety constraints." required rows={3} value={goal} />
            </label>
            <label>
              Trigger phrases
              <input onChange={(event) => setTriggers(event.target.value)} placeholder="customer escalation, urgent support, churn risk" required value={triggers} />
              <small>Comma-separated phrases Eve should recognize.</small>
            </label>
            <div className="steps-label"><span>Procedure</span><small>Use the exact conventions your team follows.</small></div>
            <div className="step-fields">
              {steps.map((step, index) => (
                <div className="step-field" key={index}>
                  <span>{index + 1}</span>
                  <input
                    onChange={(event) => setSteps((current) => current.map((value, position) => position === index ? event.target.value : value))}
                    placeholder={index === 0 ? "Find the latest escalation and verify the account" : "Summarize facts before drafting any response"}
                    value={step}
                  />
                  {steps.length > 1 ? <button aria-label={`Remove step ${index + 1}`} onClick={() => setSteps((current) => current.filter((_, position) => position !== index))} type="button"><X size={14} /></button> : null}
                </div>
              ))}
            </div>
            <button className="add-step" onClick={() => setSteps((current) => [...current, ""])} type="button"><Plus size={14} /> Add step</button>
            <button className="primary-action" disabled={saving} type="submit">{saving ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}Teach this behavior</button>
          </form>

          <div className="teach-side">
            <section className="panel learned-panel">
              <div className="panel-heading compact">
                <div><span className="step-number">2</span><div><h3>Learned behaviors</h3><p>Active immediately through retrieval.</p></div></div>
                <span className="count-badge">{examples.length}</span>
              </div>
              <div className="examples-list">
                {examples.length ? examples.map((example) => (
                  <details className="example-card" key={example._id}>
                    <summary><span className="example-icon"><Code2 size={15} /></span><div><strong>{example.title}</strong><small>{example.triggers.slice(0, 3).join(" · ")}</small></div><ChevronDown size={14} /></summary>
                    <div><p>{example.goal}</p><ol>{example.steps.map((step, index) => <li key={index}>{step.instruction}</li>)}</ol></div>
                  </details>
                )) : <div className="no-examples"><BookOpen size={21} /><strong>No behaviors yet</strong><span>Your first approved procedure will appear here.</span></div>}
              </div>
            </section>

            <section className="panel training-panel">
              <div className="preview-chip">Preview</div>
              <div className="training-icon"><BrainCircuit size={20} /></div>
              <h3>Task adapter training</h3>
              <p>Estimate a future local LoRA run from your approved examples. This hackathon version is intentionally a simulation: it does not claim to change model weights.</p>
              <div className="training-flow"><span>Examples</span><i>→</i><span>Dataset</span><i>→</i><span>LoRA</span></div>
              <button disabled={training || examples.length === 0} onClick={() => void previewTraining()} type="button">{training ? <RefreshCw className="spin" size={15} /> : <Zap size={15} />}Preview training job</button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  if (part.type === "dynamic-tool") return part.toolCallId;
  if (part.type === "authorization") return `${part.turnId}:${part.name}`;
  return `${part.type}:${index}`;
}

function humanize(value: string): string {
  return value.replace(/[._-]/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function shortId(value: string): string {
  return value.length > 15 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function toolStateLabel(state: EveDynamicToolPart["state"]): string {
  return {
    "approval-requested": "Waiting for your approval",
    "approval-responded": "Approval received",
    "input-available": "Running",
    "input-streaming": "Preparing",
    "output-available": "Completed",
    "output-denied": "Denied",
    "output-error": "Failed",
  }[state];
}

function formatData(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function relativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000));
  if (seconds < 20) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
