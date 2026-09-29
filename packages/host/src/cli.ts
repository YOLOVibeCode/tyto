import { execFile } from "node:child_process";
import { startHost } from "./boot.ts";

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
  const started = await startHost({ ...env, TYTO_LIVE: "1" });
  process.stdout.write(`Tyto is running at ${started.server.url}\n`);
  process.stdout.write(`Host state and tokens: ${started.home} (tokens are 0600; never share them)\n`);
  process.stdout.write("Chrome launched with a dedicated Tyto profile. Perch opens with a one-time link.\n");
  openPerch(started.server.perchLink());
  const shutdown = (): void => {
    void started.stop().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "start failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
