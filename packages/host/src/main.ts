import { homedir } from "node:os";
import { join } from "node:path";
import {
  extractFromAx,
  IdleOccupancy,
  LoopbackBindPolicy,
  MemoryTape,
  OriginAllowlist,
  type Navigation,
} from "@tyto/core";
import { CdpLauncher } from "@tyto/cdp";
import { FilesystemSessionStore } from "@tyto/fs";
import { OpenAiCatalog, OpenAiCompatModel } from "@tyto/llm";
import { listen, type HostServer, type ListenConfig } from "./listen.ts";

class UnlaunchedNavigation implements Navigation {
  async goto(_url: URL): Promise<void> {
    throw new Error("browser not launched");
  }

  async currentUrl(): Promise<URL> {
    return new URL("about:blank");
  }
}

/** Composition root. Bind loopback only. Never log the token. */
export function composeFromEnv(
  env: Record<string, string | undefined>,
  overrides: Partial<ListenConfig> = {},
): ListenConfig {
  const token = env.TYTO_HOST_TOKEN ?? "";
  if (token.length < 16) throw new Error("TYTO_HOST_TOKEN required");
  const bind = env.TYTO_BIND ?? "127.0.0.1";
  new LoopbackBindPolicy().assertLoopback(bind);
  const sessionDir = env.TYTO_SESSION_DIR ?? join(homedir(), ".tyto", "sessions");
  const allowlist = new OriginAllowlist();
  for (const part of (env.TYTO_ALLOW ?? "").split(",")) {
    const origin = part.trim();
    if (origin) allowlist.grant(origin);
  }
  const baseUrlRaw = env.TYTO_BASE_URL ?? "http://127.0.0.1:11434/v1";
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlRaw);
  } catch {
    throw new Error("TYTO_BASE_URL invalid");
  }
  const apiKey = env.TYTO_API_KEY ?? "";
  const defaultModel = env.TYTO_MODEL ?? "gpt-oss:20b";
  const config: ListenConfig = {
    bind,
    token,
    sessions: new FilesystemSessionStore(sessionDir),
    allowlist,
    navigation: new UnlaunchedNavigation(),
    occupancy: new IdleOccupancy(),
    launcher: new CdpLauncher(),
    observation: new MemoryTape(),
    models: new OpenAiCompatModel({ baseUrl, apiKey, model: defaultModel }),
    modelBaseUrl: baseUrl,
    modelApiKey: apiKey,
    modelResolver: (id: string) =>
      new OpenAiCompatModel({ baseUrl, apiKey, model: id }),
    catalog: new OpenAiCatalog(),
    extractor: {
      fromAx(snap, query) {
        return extractFromAx(snap, query);
      },
    },
    ...overrides,
  };
  if (env.TYTO_PORT !== undefined && env.TYTO_PORT !== "") {
    const port = Number(env.TYTO_PORT);
    if (!Number.isFinite(port) || port < 0) throw new Error("TYTO_PORT invalid");
    config.port = port;
  }
  return config;
}

export async function startHost(env: NodeJS.ProcessEnv = process.env): Promise<HostServer> {
  return listen(composeFromEnv(env));
}
