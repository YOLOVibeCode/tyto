import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoopbackBindPolicy, SecretRedactor, type BindPolicy } from "@tyto/core";
import { isPowerMethod, methodAllowed, RPC_ERROR, type JsonRpcId } from "@tyto/protocol";
import { authorizeScope, headerValue, type HostTokens } from "./auth.ts";
import { dispatch, type DispatchPorts, type Runtime } from "./dispatch.ts";
import { isJsonRpcRequest, readBody, RpcException, writeRpc, writeUnauthorized } from "./rpc.ts";

const PERCH_HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "perch.html"), "utf8");

const PERCH_LINK_TTL_MS = 5 * 60 * 1000;

export type ListenConfig = DispatchPorts & {
  bind: string;
  port?: number;
  /** Power-scope token (the CLI). Bearer only; never served over HTTP. */
  token: string;
  /** Safe-scope token (Perch, MCP). Generated if omitted. */
  safeToken?: string;
  bindPolicy?: BindPolicy;
};

export type HostServer = {
  readonly bind: string;
  readonly port: number;
  readonly url: string;
  /** Mint a one-time, short-lived link that gives a browser the safe-scope cookie. */
  perchLink(): string;
  close(): Promise<void>;
};

type Gate = {
  tokens: HostTokens;
  port: number;
  links: Map<string, number>;
};

export async function listen(config: ListenConfig): Promise<HostServer> {
  const bindPolicy = config.bindPolicy ?? new LoopbackBindPolicy();
  bindPolicy.assertLoopback(config.bind);

  const ports: DispatchPorts = {
    ...config,
    redactor: config.redactor ?? new SecretRedactor(),
  };
  const runtime: Runtime = { browser: undefined, loop: undefined };
  const safe = config.safeToken ?? randomBytes(32).toString("hex");
  if (safe === config.token) throw new Error("safe and power tokens must differ");
  const gate: Gate = { tokens: { power: config.token, safe }, port: 0, links: new Map() };

  const server = createServer((req, res) => {
    void handleRequest(req, res, gate, ports, runtime);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(config.port ?? 0, config.bind, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("listen failed");
  }

  const bind = addr.address === "::ffff:127.0.0.1" ? "127.0.0.1" : addr.address;
  gate.port = addr.port;
  const url = `http://127.0.0.1:${addr.port}/`;
  let closed = false;

  return {
    bind,
    port: addr.port,
    url,
    perchLink() {
      const nonce = randomBytes(24).toString("hex");
      gate.links.set(nonce, Date.now() + PERCH_LINK_TTL_MS);
      return `${url}?k=${nonce}`;
    },
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  gate: Gate,
  ports: DispatchPorts,
  runtime: Runtime,
): Promise<void> {
  // DNS rebinding: only our own loopback name + port. Cross-site: only our own Origin.
  if (!hostAllowed(headerValue(req.headers.host), gate.port) || !originAllowed(headerValue(req.headers.origin), gate.port)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    servePerch(req, res, gate);
    return;
  }
  await handleRpc(req, res, gate, ports, runtime);
}

function loopbackNames(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host || port === 0) return false;
  return loopbackNames(port).includes(host.toLowerCase());
}

function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return loopbackNames(port).some((name) => origin.toLowerCase() === `http://${name}`);
}

/** Consume a one-time Perch link nonce from `?k=`. */
function takeLink(req: IncomingMessage, gate: Gate): boolean {
  const k = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("k");
  if (!k) return false;
  const expires = gate.links.get(k);
  gate.links.delete(k);
  return expires !== undefined && expires >= Date.now();
}

function servePerch(req: IncomingMessage, res: ServerResponse, gate: Gate): void {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method === "GET" && takeLink(req, gate)) {
    res.statusCode = 303;
    res.setHeader("set-cookie", `tyto_at=${encodeURIComponent(gate.tokens.safe)}; HttpOnly; SameSite=Strict; Path=/`);
    res.setHeader("location", "/");
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(PERCH_HTML);
}

async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  gate: Gate,
  ports: DispatchPorts,
  runtime: Runtime,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }

  const ac = new AbortController();
  const onClientGone = (): void => {
    if (!res.writableEnded) ac.abort();
  };
  res.once("close", onClientGone);

  let id: JsonRpcId = null;
  try {
    // Authorize from headers before reading the body.
    const scope = authorizeScope(headerValue(req.headers.authorization), headerValue(req.headers.cookie), gate.tokens);
    if (!scope) {
      res.setHeader("connection", "close");
      writeUnauthorized(res, id);
      return;
    }
    const raw = await readBody(req);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      writeRpc(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: RPC_ERROR.PARSE, message: "parse error" },
      });
      return;
    }
    if (!isJsonRpcRequest(parsed)) {
      writeRpc(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: RPC_ERROR.INVALID_REQUEST, message: "invalid request" },
      });
      return;
    }
    id = parsed.id;
    if (!methodAllowed(scope, parsed.method)) {
      if (isPowerMethod(parsed.method)) {
        writeUnauthorized(res, id);
        return;
      }
      throw new RpcException(RPC_ERROR.METHOD_NOT_FOUND, "method not found");
    }
    const result = await dispatch(parsed.method, parsed.params, ports, runtime, ac.signal);
    writeRpc(res, 200, { jsonrpc: "2.0", id, result });
  } catch (e) {
    if (res.writableEnded || res.destroyed) return;
    if (e instanceof RpcException) {
      writeRpc(res, e.code === RPC_ERROR.UNAUTHORIZED ? 401 : 200, {
        jsonrpc: "2.0",
        id,
        error: { code: e.code, message: e.message },
      });
      return;
    }
    if (ac.signal.aborted) return;
    writeRpc(res, 200, {
      jsonrpc: "2.0",
      id,
      error: { code: RPC_ERROR.INTERNAL, message: "internal error" },
    });
  } finally {
    res.off("close", onClientGone);
  }
}
