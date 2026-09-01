import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { LoopbackBindPolicy } from "@tyto/core";

export const NATIVE_HOST_NAME = "com.noctusoft.tyto";

/** Chrome extension id: first 16 bytes of SHA-256(SPKI DER), mapped 0–15 → a–p. */
export function extensionIdFromKeyField(base64: string): string {
  const der = Buffer.from(base64, "base64");
  const hash = createHash("sha256").update(der).digest().subarray(0, 16);
  let id = "";
  for (const byte of hash) {
    id += String.fromCharCode(97 + ((byte >> 4) & 0xf));
    id += String.fromCharCode(97 + (byte & 0xf));
  }
  return id;
}

export function nativeHostDir(browser: "chrome" | "edge", platform: NodeJS.Platform, home: string): string {
  if (platform === "darwin") {
    return browser === "edge"
      ? join(home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts")
      : join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts");
  }
  if (platform === "win32") {
    const local = join(home, "AppData", "Local");
    return browser === "edge"
      ? join(local, "Microsoft", "Edge", "User Data", "NativeMessagingHosts")
      : join(local, "Google", "Chrome", "User Data", "NativeMessagingHosts");
  }
  return browser === "edge"
    ? join(home, ".config/microsoft-edge/NativeMessagingHosts")
    : join(home, ".config/google-chrome/NativeMessagingHosts");
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function installNativeHost(opts: {
  destDir: string;
  extensionId: string;
  execPath: string;
  scriptPath: string;
  tsxPath: string;
  authPath: string;
}): Promise<void> {
  if (!/^[a-p]{32}$/.test(opts.extensionId)) throw new Error("extension id invalid");
  await mkdir(opts.destDir, { recursive: true });
  const wrapperPath = join(opts.destDir, NATIVE_HOST_NAME);
  const wrapper = `#!/bin/sh
export TYTO_NATIVE_AUTH=${shellEscape(opts.authPath)}
exec ${shellEscape(opts.execPath)} ${shellEscape(opts.tsxPath)} ${shellEscape(opts.scriptPath)}
`;
  await writeFile(wrapperPath, wrapper, { encoding: "utf8", mode: 0o755 });
  await chmod(wrapperPath, 0o755);
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: "Tyto native host",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${opts.extensionId}/`],
  };
  await writeFile(join(opts.destDir, `${NATIVE_HOST_NAME}.json`), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
  });
}

export async function writeNativeAuth(
  path: string,
  auth: { token: string; port: number; bridgePort?: number },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body: { token: string; port: number; bridgePort?: number } = { token: auth.token, port: auth.port };
  if (auth.bridgePort !== undefined) body.bridgePort = auth.bridgePort;
  await writeFile(path, `${JSON.stringify(body)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export function nativeHelloReply(msg: unknown, auth: { token: string; port: number }): unknown {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { error: "invalid" };
  const type = (msg as { type?: unknown }).type;
  if (type === "fromPage") return { ignored: true };
  if (type !== "hello") return { error: "rejected" };
  return { type: "hello", port: String(auth.port), token: auth.token };
}

export function encodeNativeMessage(payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

export function decodeNativeMessage(buf: Buffer): unknown {
  if (buf.length < 4) throw new Error("native frame short");
  const n = buf.readUInt32LE(0);
  if (n > 1_000_000) throw new Error("native frame too large");
  if (buf.length < 4 + n) throw new Error("native frame short");
  return JSON.parse(buf.subarray(4, 4 + n).toString("utf8")) as unknown;
}

export async function runNativeStdio(opts: {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  authPath: string;
}): Promise<void> {
  let auth: { token: string; port: number; bridgePort?: number };
  try {
    const raw = JSON.parse(await readFile(opts.authPath, "utf8")) as {
      token?: unknown;
      port?: unknown;
      bridgePort?: unknown;
    };
    const token = typeof raw.token === "string" ? raw.token : "";
    const port = typeof raw.port === "number" ? raw.port : Number(raw.port);
    if (token.length < 16 || !Number.isFinite(port)) throw new Error("native auth invalid");
    const bridgePort = typeof raw.bridgePort === "number" ? raw.bridgePort : undefined;
    auth = bridgePort !== undefined ? { token, port, bridgePort } : { token, port };
  } catch {
    opts.stderr.write("native auth missing\n");
    return;
  }

  let socket: import("node:net").Socket | undefined;
  if (auth.bridgePort !== undefined) {
    new LoopbackBindPolicy().assertLoopback("127.0.0.1");
    socket = createConnection({ host: "127.0.0.1", port: auth.bridgePort });
    try {
      await once(socket, "connect");
    } catch {
      opts.stderr.write("bridge missing\n");
      socket = undefined;
    }
    socket?.on("data", (chunk: Buffer) => {
      opts.stdout.write(chunk);
    });
  }

  let buf = Buffer.alloc(0);
  let helloDone = false;
  for await (const chunk of opts.stdin) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= 4) {
      const n = buf.readUInt32LE(0);
      if (n > 1_000_000) throw new Error("native frame too large");
      if (buf.length < 4 + n) break;
      const frame = buf.subarray(0, 4 + n);
      const msg = JSON.parse(buf.subarray(4, 4 + n).toString("utf8")) as unknown;
      buf = buf.subarray(4 + n);
      if (!helloDone) {
        opts.stdout.write(encodeNativeMessage(nativeHelloReply(msg, auth)));
        helloDone = true;
        continue;
      }
      socket?.write(frame);
    }
  }
}

export function extensionIdFromManifestJson(raw: string): string {
  const parsed = JSON.parse(raw) as { key?: unknown };
  if (typeof parsed.key !== "string" || !parsed.key) throw new Error("manifest key required");
  return extensionIdFromKeyField(parsed.key);
}
