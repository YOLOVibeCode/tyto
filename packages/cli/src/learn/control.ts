import { chmod, mkdir, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname } from "node:path";
import type { TraceInput } from "@tyto/core";

export type ControlRequest = { op: "status" } | { op: "stop"; task: string; keep: Record<string, string> };

export type ControlReply = {
  ok: boolean;
  error?: string;
  inputs?: TraceInput[];
  steps?: number;
  lossy?: boolean;
  gaps?: string[];
  params?: Record<string, string>;
  trace?: string;
};

const MAX_MESSAGE = 1_000_000;

/** Serve JSON-line requests on a unix socket inside a 0700 directory. Returns a close function. */
export async function serveControl(path: string, handler: (req: ControlRequest) => Promise<ControlReply>): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await rm(path, { force: true });
  const server = createServer((socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_MESSAGE) socket.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      buf = "";
      let req: ControlRequest;
      try {
        req = JSON.parse(line) as ControlRequest;
      } catch {
        socket.end(`${JSON.stringify({ ok: false, error: "bad request" })}\n`);
        return;
      }
      handler(req).then(
        (reply) => socket.end(`${JSON.stringify(reply)}\n`),
        (err: unknown) => socket.end(`${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`),
      );
    });
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  await chmod(path, 0o600);
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(path, { force: true });
  };
}

export function requestControl(path: string, req: ControlRequest, timeoutMs = 15_000): Promise<ControlReply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("the recorder did not answer"));
    }, timeoutMs);
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
    socket.on("data", (chunk: string) => {
      buf += chunk;
    });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf) as ControlReply);
      } catch {
        reject(new Error("the recorder sent an unreadable reply"));
      }
    });
    socket.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") reject(new Error("not recording (no tyto learn listener for that name)"));
      else reject(err);
    });
  });
}
