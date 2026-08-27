import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TytoClient } from "@tyto/sdk";
import { composeFromEnv } from "./main.ts";
import { listen, type HostServer, type ListenConfig } from "./listen.ts";

export function ensureHostToken(env: Record<string, string | undefined>): string {
  const existing = env.TYTO_HOST_TOKEN ?? "";
  if (existing.length >= 16) return existing;
  return randomBytes(32).toString("hex");
}

export async function persistHostToken(envPath: string, token: string): Promise<"written" | "exists"> {
  let prev = "";
  try {
    prev = await readFile(envPath, "utf8");
  } catch {
    prev = "";
  }
  if (/(?:^|\n)TYTO_HOST_TOKEN=/m.test(prev)) return "exists";
  const prefix = prev && !prev.endsWith("\n") ? "\n" : "";
  const next = `${prev}${prefix}TYTO_HOST_TOKEN=${token}\n`;
  await writeFile(envPath, next, { encoding: "utf8", mode: 0o600 });
  return "written";
}

export async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = addr && typeof addr !== "string" ? addr.port : 0;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
  if (!port) throw new Error("free port failed");
  return port;
}

export async function bootLive(
  env: Record<string, string | undefined>,
  overrides: Partial<ListenConfig> = {},
): Promise<HostServer> {
  const token = ensureHostToken(env);
  const config = composeFromEnv({ ...env, TYTO_HOST_TOKEN: token }, overrides);
  const server = await listen({ ...config, port: config.port ?? 7420 });
  const client = new TytoClient({ url: server.url, token: config.token });
  const debugPort =
    env.TYTO_DEBUG_PORT !== undefined && env.TYTO_DEBUG_PORT !== ""
      ? Number(env.TYTO_DEBUG_PORT)
      : await freeLoopbackPort();
  if (!Number.isFinite(debugPort) || debugPort <= 0) {
    await server.close();
    throw new Error("TYTO_DEBUG_PORT invalid");
  }
  const userDataDir = env.TYTO_PROFILE ?? join(homedir(), ".tyto", "profile");
  try {
    await mkdir(userDataDir, { recursive: true });
    await client.call("browser.launch", {
      browser: env.TYTO_BROWSER === "edge" ? "edge" : "chrome",
      userDataDir,
      port: debugPort,
    });
  } catch (err) {
    await server.close();
    throw err;
  }
  return server;
}
