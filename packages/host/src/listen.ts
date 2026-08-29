import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LoopbackBindPolicy, SecretRedactor, type BindPolicy } from "@tyto/core";
import { RPC_ERROR, type JsonRpcId } from "@tyto/protocol";
import { headerValue, requestAuthorized } from "./auth.ts";
import { dispatch, type DispatchPorts, type Runtime } from "./dispatch.ts";
import { isJsonRpcRequest, readBody, RpcException, writeRpc, writeUnauthorized } from "./rpc.ts";

const PERCH_HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "perch.html"), "utf8");

export type ListenConfig = DispatchPorts & {
  bind: string;
  port?: number;
  token: string;
  bindPolicy?: BindPolicy;
};

export type HostServer = {
  readonly bind: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
};

export async function listen(config: ListenConfig): Promise<HostServer> {
  const bindPolicy = config.bindPolicy ?? new LoopbackBindPolicy();
  bindPolicy.assertLoopback(config.bind);

  const ports: DispatchPorts = {
    ...config,
    redactor: config.redactor ?? new SecretRedactor(),
  };
  const runtime: Runtime = { browser: undefined, loop: undefined };

  const server = createServer((req, res) => {
    void handleRequest(req, res, config.token, ports, runtime);
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
  let closed = false;

  return {
    bind,
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}/`,
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
  token: string,
  ports: DispatchPorts,
  runtime: Runtime,
): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD") {
    servePerch(req, res, token);
    return;
  }
  await handleRpc(req, res, token, ports, runtime);
}

function servePerch(req: IncomingMessage, res: ServerResponse, token: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("set-cookie", `tyto_at=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(PERCH_HTML);
}

async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
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
    const raw = await readBody(req);
    if (!requestAuthorized(headerValue(req.headers.authorization), headerValue(req.headers.cookie), token)) {
      writeUnauthorized(res, id);
      return;
    }

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
