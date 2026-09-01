import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NATIVE_HOST_NAME,
  decodeNativeMessage,
  encodeNativeMessage,
  extensionIdFromKeyField,
  installNativeHost,
  nativeHelloReply,
  nativeHostDir,
  runNativeStdio,
  writeNativeAuth,
} from "../src/native-host.ts";

const TOKEN = "n".repeat(32);
const MANIFEST = readFileSync(
  fileURLToPath(new URL("../../../extension/manifest.json", import.meta.url)),
  "utf8",
);

describe("native messaging host", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  });

  it("manifest key yields a stable 32-char a-p extension id", () => {
    const parsed = JSON.parse(MANIFEST) as { key?: string };
    expect(typeof parsed.key).toBe("string");
    const id = extensionIdFromKeyField(parsed.key ?? "");
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(id).toBe("iidndmgmpifgjjagijfcolhoppjfkokl");
  });

  it("nativeHostDir is Chrome/Edge NativeMessagingHosts, not the Tyto profile", () => {
    expect(nativeHostDir("chrome", "darwin", "/Users/op")).toBe(
      "/Users/op/Library/Application Support/Google/Chrome/NativeMessagingHosts",
    );
    expect(nativeHostDir("edge", "darwin", "/Users/op")).toBe(
      "/Users/op/Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    );
    expect(nativeHostDir("chrome", "linux", "/home/op")).toBe(
      "/home/op/.config/google-chrome/NativeMessagingHosts",
    );
  });

  it("installNativeHost writes stdio manifest with Tyto origin and no token", async () => {
    const dest = await mkdtemp(join(tmpdir(), "tyto-nmh-"));
    dirs.push(dest);
    const hostPath = join(dest, NATIVE_HOST_NAME);
    const id = extensionIdFromKeyField((JSON.parse(MANIFEST) as { key: string }).key);
    await installNativeHost({
      destDir: dest,
      extensionId: id,
      execPath: "/usr/bin/node",
      scriptPath: "/repo/packages/host/src/native-host-main.ts",
      tsxPath: "/repo/node_modules/tsx/dist/cli.mjs",
      authPath: "/tmp/tyto-native-auth.json",
    });
    const raw = await readFile(join(dest, `${NATIVE_HOST_NAME}.json`), "utf8");
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toMatch(/hostToken|TYTO_HOST_TOKEN/i);
    const manifest = JSON.parse(raw) as {
      name: string;
      path: string;
      type: string;
      allowed_origins: string[];
    };
    expect(manifest.name).toBe(NATIVE_HOST_NAME);
    expect(manifest.type).toBe("stdio");
    expect(manifest.path).toBe(hostPath);
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${id}/`]);
    const wrapper = await readFile(hostPath, "utf8");
    expect(wrapper).toContain("/usr/bin/node");
    expect(wrapper).not.toContain(TOKEN);
  });

  it("writeNativeAuth is owner-only and hello replies with port+token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-auth-"));
    dirs.push(dir);
    const authPath = join(dir, "native-auth.json");
    await writeNativeAuth(authPath, { token: TOKEN, port: 7420 });
    const mode = (await stat(authPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    const reply = nativeHelloReply({ type: "hello" }, { token: TOKEN, port: 7420 });
    expect(reply).toEqual({ type: "hello", port: "7420", token: TOKEN });
    expect(nativeHelloReply({ type: "fromPage" }, { token: TOKEN, port: 7420 })).toEqual({
      ignored: true,
    });
    expect(nativeHelloReply({ type: "cdp", method: "Runtime.evaluate" }, { token: TOKEN, port: 7420 })).toEqual(
      { error: "rejected" },
    );
  });

  it("stdio framing is 4-byte little-endian length, not a leaked token on stderr", async () => {
    const payload = { type: "hello" };
    const framed = encodeNativeMessage(payload);
    expect(framed.readUInt32LE(0)).toBe(Buffer.byteLength(JSON.stringify(payload)));
    expect(decodeNativeMessage(framed)).toEqual(payload);

    const authDir = await mkdtemp(join(tmpdir(), "tyto-auth-"));
    dirs.push(authDir);
    const authPath = join(authDir, "native-auth.json");
    await writeNativeAuth(authPath, { token: TOKEN, port: 7421 });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderrChunks: Buffer[] = [];
    const stderr = new PassThrough();
    stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    const done = runNativeStdio({ stdin, stdout, stderr, authPath });
    stdin.write(encodeNativeMessage({ type: "hello" }));
    stdin.end();
    const out: Buffer[] = [];
    stdout.on("data", (c: Buffer) => out.push(c));
    await done;
    const reply = decodeNativeMessage(Buffer.concat(out));
    expect(reply).toEqual({ type: "hello", port: "7421", token: TOKEN });
    expect(Buffer.concat(stderrChunks).toString("utf8")).not.toContain(TOKEN);
  });
});
