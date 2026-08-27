import type {
  Actuation,
  Allowlist,
  AxSnapshot,
  BrowserHandle,
  CompleteRequest,
  ConfirmReason,
  Extractor,
  FrameGraph,
  FrameRef,
  IdentityVault,
  Intent,
  Launcher,
  ModelCatalog,
  ModelPort,
  Navigation,
  Observation,
  Occupancy,
  Operator,
  Perception,
  ProfileCatalog,
  Readiness,
  Redactor,
  Session,
  SessionStore,
  TrustedIntent,
} from "@tyto/core";
import { AgentLoop, parseSession } from "@tyto/core";
import { isPerchSafeMethod, RPC_ERROR } from "@tyto/protocol";
import { attachCdpAdapters } from "./attach-cdp.ts";
import { record, RpcException } from "./rpc.ts";

export type Runtime = {
  browser: BrowserHandle | undefined;
};

export type DispatchPorts = {
  sessions: SessionStore;
  allowlist: Allowlist;
  navigation: Navigation;
  redactor?: Redactor;
  observation?: Observation;
  perception?: Perception;
  actuation?: Actuation;
  readiness?: Readiness;
  extractor?: Extractor;
  frames?: FrameGraph;
  occupancy?: Occupancy;
  operator?: Operator;
  models?: ModelPort;
  catalog?: ModelCatalog;
  vault?: IdentityVault;
  profiles?: ProfileCatalog;
  launcher?: Launcher;
};

function need<T>(port: T | undefined, name: string): T {
  if (!port) throw new RpcException(RPC_ERROR.INTERNAL, `${name} not attached`);
  return port;
}

export async function dispatch(
  method: string,
  params: unknown,
  ports: DispatchPorts,
  runtime: Runtime,
  signal: AbortSignal,
): Promise<unknown> {
  if (!isPerchSafeMethod(method)) {
    throw new RpcException(RPC_ERROR.METHOD_NOT_FOUND, "method not found");
  }
  switch (method) {
    case "session.open":
      return sessionOpen(params, ports.sessions);
    case "session.save":
      return sessionSave(params, ports.sessions);
    case "session.list":
      return ports.sessions.list();
    case "session.run":
      return sessionRun(params, ports, signal);
    case "profiles.list":
      return profilesList(params, ports.profiles);
    case "browser.launch":
      return browserLaunch(params, need(ports.launcher, "launcher"), runtime, ports);
    case "browser.disconnect":
      await runtime.browser?.disconnect();
      runtime.browser = undefined;
      return { ok: true };
    case "page.goto":
      return pageGoto(params, ports.allowlist, ports.navigation);
    case "page.snapshot":
      return pageSnapshot(params, need(ports.perception, "perception"));
    case "page.act":
      await need(ports.actuation, "actuation").perform(params as TrustedIntent);
      return { ok: true };
    case "page.waitReady":
      return need(ports.readiness, "readiness").waitReady(Number(record(params).budget ?? 0));
    case "page.extract":
      return pageExtract(params, need(ports.perception, "perception"), need(ports.extractor, "extractor"));
    case "frames.list":
      return need(ports.frames, "frames").list(String(record(params).tabId ?? ""));
    case "frames.focus":
      need(ports.frames, "frames").focus(frameRef(params));
      return { ok: true };
    case "tape.recent":
      return tapeRecent(params, need(ports.observation, "observation"), need(ports.redactor, "redactor"));
    case "tape.wait":
      return tapeWait(params, need(ports.observation, "observation"), need(ports.redactor, "redactor"), signal);
    case "operator.interrupt":
      ports.occupancy?.interrupt();
      return { ok: true };
    case "operator.confirm":
      return operatorConfirm(params, need(ports.operator, "operator"));
    case "operator.grantOrigin": {
      const origin = String(record(params).origin ?? "");
      if (!origin) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "origin required");
      ports.allowlist.grant(origin);
      return { ok: true };
    }
    case "identity.status":
      return identityStatus(params, ports.vault);
    case "models.complete":
      return modelsComplete(params, need(ports.models, "models"), need(ports.redactor, "redactor"));
    case "models.list":
      return modelsList(params, need(ports.catalog, "catalog"));
  }
}

async function sessionOpen(params: unknown, sessions: SessionStore): Promise<unknown> {
  const id = String(record(params).id ?? "");
  if (!id) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session.id required");
  const session = await sessions.load(id);
  if (!session) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session not found");
  return session;
}

async function sessionSave(params: unknown, sessions: SessionStore): Promise<unknown> {
  const raw = record(params).session;
  if (raw == null) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session required");
  const session = parseSession(JSON.stringify(raw));
  if (!session.id) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session.id required");
  await sessions.save(session);
  return { ok: true };
}

async function sessionRun(params: unknown, ports: DispatchPorts, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw abortError(signal);
  const id = String(record(params).id ?? "");
  if (!id) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session.id required");
  const session = await ports.sessions.load(id);
  if (!session) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "session not found");
  const perception = need(ports.perception, "perception");
  const actuation = need(ports.actuation, "actuation");
  const model = need(ports.models, "models");
  const occupancy = need(ports.occupancy, "occupancy");
  const redactor = need(ports.redactor, "redactor");
  const frame = runFrame(params, session);
  const snap = await perception.snapshot(frame);
  const loop = new AgentLoop({ store: ports.sessions, occupancy, actuation, model, redactor });
  try {
    await loop.play(session, snap, frame);
  } finally {
    loop.release();
  }
  return { ok: true };
}

function runFrame(params: unknown, session: Session): FrameRef {
  const p = record(params);
  if (p.frame !== undefined && p.frame !== null) return frameRef(params);
  if (session.lastUrl) {
    try {
      return { tabId: "t", frameId: "main", origin: new URL(session.lastUrl).origin };
    } catch {
      // fall through
    }
  }
  return { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" };
}

async function profilesList(params: unknown, profiles: ProfileCatalog | undefined): Promise<unknown> {
  if (!profiles) return [];
  const browser = record(params).browser === "edge" ? "edge" : "chrome";
  return profiles.list(browser);
}

async function browserLaunch(
  params: unknown,
  launcher: Launcher,
  runtime: Runtime,
  ports: DispatchPorts,
): Promise<unknown> {
  const p = record(params);
  runtime.browser = await launcher.launch({
    browser: p.browser === "edge" ? "edge" : "chrome",
    userDataDir: String(p.userDataDir ?? ""),
    port: Number(p.port ?? 0),
    bindHost: "127.0.0.1",
  });
  attachCdpAdapters(runtime.browser, ports);
  return { ok: true };
}

async function pageGoto(params: unknown, allowlist: Allowlist, navigation: Navigation): Promise<unknown> {
  const raw = record(params).url;
  if (typeof raw !== "string" || !raw) {
    throw new RpcException(RPC_ERROR.INVALID_PARAMS, "url required");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RpcException(RPC_ERROR.INVALID_PARAMS, "url invalid");
  }
  if (!allowlist.permits(url)) {
    throw new RpcException(RPC_ERROR.POLICY, "origin not allowed");
  }
  await navigation.goto(url);
  return { ok: true };
}

async function pageSnapshot(params: unknown, perception: Perception): Promise<unknown> {
  return wireSnapshot(await perception.snapshot(frameRef(params)));
}

async function pageExtract(params: unknown, perception: Perception, extractor: Extractor): Promise<unknown> {
  const query = String(record(params).query ?? "");
  const snap = await perception.snapshot(frameRef(params));
  return extractor.fromAx(snap, query);
}

function tapeRecent(params: unknown, observation: Observation, redactor: Redactor): unknown {
  const n = Number(record(params).n ?? 20);
  return observation.recent(n).map((e) => redactor.tape(e));
}

async function tapeWait(
  params: unknown,
  observation: Observation,
  redactor: Redactor,
  signal: AbortSignal,
): Promise<unknown> {
  const timeoutMs = Number(record(params).timeoutMs ?? 0);
  const kind = record(params).kind;
  const match = (detail: { kind: string }): boolean => kind == null || detail.kind === kind;
  const existing = observation.recent(50).find(match);
  if (existing) return { ok: true, event: redactor.tape(existing) };

  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const unsub = observation.subscribe((e) => {
      if (!match(e)) return;
      cleanup();
      resolve({ ok: true, event: redactor.tape(e) });
    });
    const onAbort = (): void => {
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            cleanup();
            resolve({ ok: false, reason: "timeout" });
          }, timeoutMs)
        : undefined;
    function cleanup(): void {
      unsub();
      signal.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
    }
  });
}

async function operatorConfirm(params: unknown, operator: Operator): Promise<unknown> {
  const p = record(params);
  const ok = await operator.confirm(p.reason as ConfirmReason, p.intent as Intent);
  return { ok };
}

async function identityStatus(params: unknown, vault: IdentityVault | undefined): Promise<unknown> {
  const origin = String(record(params).origin ?? "");
  if (!origin) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "origin required");
  if (!vault) return { status: "none" };
  return { status: await vault.status(origin) };
}

async function modelsComplete(params: unknown, models: ModelPort, redactor: Redactor): Promise<unknown> {
  const p = record(params);
  const req: CompleteRequest = {
    system: String(p.system ?? ""),
    user: String(p.user ?? ""),
    ...(isUntrustedPage(p.page) ? { page: p.page } : {}),
  };
  return models.complete(redactor.prompt(req));
}

async function modelsList(params: unknown, catalog: ModelCatalog): Promise<unknown> {
  const p = record(params);
  const base = String(p.baseUrl ?? "");
  if (!base) throw new RpcException(RPC_ERROR.INVALID_PARAMS, "baseUrl required");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new RpcException(RPC_ERROR.INVALID_PARAMS, "baseUrl invalid");
  }
  return catalog.list(url, String(p.apiKey ?? ""));
}

function frameRef(params: unknown): FrameRef {
  const p = record(params);
  const nested = p.frame !== null && typeof p.frame === "object" ? record(p.frame) : p;
  return {
    tabId: String(nested.tabId ?? ""),
    frameId: String(nested.frameId ?? ""),
    origin: String(nested.origin ?? ""),
  };
}

function wireSnapshot(snap: AxSnapshot): unknown {
  const refs = [...snap.refs.values()].map((r) => ({ ref: r.ref, role: r.role, name: r.name }));
  const recipes = snap.recipes.map((r) => ({
    ref: r.ref,
    role: r.role,
    name: r.name,
    origin: r.origin,
    ...(r.landmark ? { landmark: r.landmark } : {}),
    ...(r.routePattern ? { routePattern: r.routePattern } : {}),
  }));
  return {
    generation: snap.generation,
    origin: snap.origin,
    url: snap.url,
    title: snap.title,
    tree: snap.tree,
    refs,
    recipes,
  };
}

function isUntrustedPage(v: unknown): v is { kind: "untrusted"; text: string } {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { kind?: unknown }).kind === "untrusted" &&
    typeof (v as { text?: unknown }).text === "string"
  );
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error("aborted");
}
