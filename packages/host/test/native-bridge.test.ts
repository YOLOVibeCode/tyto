import { createConnection } from "node:net";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { listenNativeBridge } from "../src/native-bridge.ts";
import {
  decodeNativeMessage,
  encodeNativeMessage,
  runNativeStdio,
  writeNativeAuth,
} from "../src/native-host.ts";

const TOKEN = "n".repeat(32);

describe("native bridge (host → extension)", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  it("listenNativeBridge refuses 0.0.0.0", async () => {
    await expect(listenNativeBridge("0.0.0.0")).rejects.toThrow(/bind refused/i);
  });

  it("post waits for the native-host pipe; frames stay on loopback", async () => {
    const bridge = await listenNativeBridge("127.0.0.1");
    closers.push(() => bridge.close());
    const sock = createConnection({ host: "127.0.0.1", port: bridge.port });
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
    await bridge.connected;
    const first = once(sock, "data");
    const pending = bridge.post({ type: "attach", tabId: 17 });
    const [chunk] = (await first) as [Buffer];
    expect(decodeNativeMessage(chunk)).toEqual({ type: "attach", tabId: 17 });
    sock.write(encodeNativeMessage({ ok: true }));
    await expect(pending).resolves.toEqual({ ok: true });
    sock.end();
  });

  it("runNativeStdio after hello forwards bridge frames, never logs the token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-bridge-"));
    const authPath = join(dir, "native-auth.json");
    const bridge = await listenNativeBridge("127.0.0.1");
    closers.push(() => bridge.close());
    await writeNativeAuth(authPath, { token: TOKEN, port: 7420, bridgePort: bridge.port });

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const err: Buffer[] = [];
    stderr.on("data", (c: Buffer) => err.push(c));

    const running = runNativeStdio({ stdin, stdout, stderr, authPath });
    await bridge.connected;
    const helloChunk = once(stdout, "data");
    stdin.write(encodeNativeMessage({ type: "hello" }));
    const hello = decodeNativeMessage((await helloChunk)[0] as Buffer);
    expect(hello).toMatchObject({ type: "hello", port: "7420" });

    const attachChunk = once(stdout, "data");
    const pending = bridge.post({ type: "attach", tabId: 9 });
    expect(decodeNativeMessage((await attachChunk)[0] as Buffer)).toEqual({ type: "attach", tabId: 9 });

    stdin.write(encodeNativeMessage({ ok: true }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(Buffer.concat(err).toString("utf8")).not.toContain(TOKEN);
    stdin.end();
    await running;
  });
});
