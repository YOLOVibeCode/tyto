import { createServer, type Socket } from "node:net";
import { LoopbackBindPolicy } from "@tyto/core";
import { encodeNativeMessage } from "./native-host.ts";

export type NativeBridge = {
  readonly port: number;
  readonly connected: Promise<void>;
  post(msg: unknown): Promise<unknown>;
  close(): Promise<void>;
};

export async function listenNativeBridge(bind: string): Promise<NativeBridge> {
  new LoopbackBindPolicy().assertLoopback(bind);
  let sock: Socket | undefined;
  let buf = Buffer.alloc(0);
  const waiters: Array<(v: unknown) => void> = [];
  let resolveConnected: () => void = () => undefined;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  const server = createServer((incoming) => {
    if (sock) {
      incoming.destroy();
      return;
    }
    sock = incoming;
    resolveConnected();
    incoming.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const n = buf.readUInt32LE(0);
        if (n > 1_000_000) return;
        if (buf.length < 4 + n) break;
        const msg = JSON.parse(buf.subarray(4, 4 + n).toString("utf8")) as unknown;
        buf = buf.subarray(4 + n);
        waiters.shift()?.(msg);
      }
    });
    incoming.on("close", () => {
      if (sock === incoming) sock = undefined;
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, bind, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("listen failed");
  }

  return {
    port: addr.port,
    connected,
    async post(msg) {
      if (!sock) throw new Error("extension native port not connected");
      const reply = new Promise<unknown>((resolve) => {
        waiters.push(resolve);
      });
      sock.write(encodeNativeMessage(msg));
      return reply;
    },
    async close() {
      sock?.destroy();
      sock = undefined;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
