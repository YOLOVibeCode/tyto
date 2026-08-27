import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { bootLive, ensureHostToken, persistHostToken } from "./boot.ts";

function openPerch(url: string): void {
  if (process.env.TYTO_NO_OPEN === "1") return;
  if (process.platform === "darwin") {
    execFile("open", [url], () => undefined);
    return;
  }
  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", url], () => undefined);
    return;
  }
  execFile("xdg-open", [url], () => undefined);
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  process.env.TYTO_LIVE = "1";
  const generated = !env.TYTO_HOST_TOKEN || env.TYTO_HOST_TOKEN.length < 16;
  const token = ensureHostToken(env);
  if (generated) {
    await persistHostToken(resolve(process.cwd(), ".env"), token);
  }
  const server = await bootLive({ ...env, TYTO_HOST_TOKEN: token, TYTO_LIVE: "1" });
  process.stdout.write(`Tyto is running at ${server.url}\n`);
  process.stdout.write("Chrome launched with an empty Tyto profile. Paste a URL and a goal, then Run.\n");
  openPerch(server.url);
  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "start failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
