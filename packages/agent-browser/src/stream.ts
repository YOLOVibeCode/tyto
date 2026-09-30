import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserEventSource, StreamEvent } from "@tyto/core";

export type WebSocketLike = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  close(): void;
};

export type StreamEventSourceOptions = {
  socketDir?: string;
  WebSocketCtor?: new (url: string) => WebSocketLike;
};

/** agent-browser's `sanitize_session_component`: lowercase alphanumerics, single separators. */
function sanitize(value: string): string {
  let out = "";
  let lastSep = false;
  for (const c of value) {
    if (/[\p{L}\p{N}]/u.test(c)) {
      out += c.toLowerCase();
      lastSep = false;
    } else if (out !== "" && !lastSep) {
      out += c === "_" ? "_" : "-";
      lastSep = true;
    }
  }
  return out.replace(/[-_]+$/, "");
}

/** Mirrors agent-browser's `get_socket_dir`, where `<session>.stream` holds the event stream port. */
export function agentBrowserSocketDir(env: Readonly<Record<string, string | undefined>> = process.env, home = homedir()): string {
  const explicit = env.AGENT_BROWSER_SOCKET_DIR;
  const runtime = env.XDG_RUNTIME_DIR;
  const base = explicit ? explicit : runtime ? join(runtime, "agent-browser") : join(home, ".agent-browser");
  const ns = env.AGENT_BROWSER_NAMESPACE ? sanitize(env.AGENT_BROWSER_NAMESPACE) : "";
  return ns ? join(base, "namespaces", ns, "run") : base;
}

/** Subscribes to a session's WebSocket event stream (lossy by design; frames are dropped). */
export class StreamEventSource implements BrowserEventSource {
  readonly #dir: string;
  readonly #Ws: new (url: string) => WebSocketLike;

  constructor(opts: StreamEventSourceOptions = {}) {
    this.#dir = opts.socketDir ?? agentBrowserSocketDir();
    this.#Ws = opts.WebSocketCtor ?? (globalThis.WebSocket as unknown as new (url: string) => WebSocketLike);
  }

  async *subscribe(session: string, signal: AbortSignal): AsyncIterable<StreamEvent> {
    if (!/^[\w.-]+$/.test(session)) throw new Error(`invalid session name: ${session}`);
    let port: string;
    try {
      port = (await readFile(join(this.#dir, `${session}.stream`), "utf8")).trim();
    } catch {
      throw new Error(`no event stream for session ${session}; is its agent-browser daemon running?`);
    }
    if (!/^\d+$/.test(port)) throw new Error(`bad event stream port for session ${session}`);

    const queue: StreamEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const push = (ev: StreamEvent): void => {
      queue.push(ev);
      wake?.();
    };
    const ws = new this.#Ws(`ws://127.0.0.1:${port}`);
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      try {
        const ev = JSON.parse(e.data) as unknown;
        if (typeof ev === "object" && ev !== null && !Array.isArray(ev) && (ev as StreamEvent).type !== "frame") push(ev as StreamEvent);
      } catch {
        return; // not JSON: the stream is advisory, skip the message
      }
    };
    ws.onclose = () => {
      if (!done) push({ type: "closed" });
      done = true;
    };
    ws.onerror = () => {
      if (!done) push({ type: "closed" });
      done = true;
    };
    const onAbort = (): void => {
      done = true;
      ws.close();
      wake?.();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!signal.aborted) {
        const next = queue.shift();
        if (next) {
          yield next;
          if (next.type === "closed") return;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (!done) {
        done = true;
        ws.close();
      }
    }
  }
}
