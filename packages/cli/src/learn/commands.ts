import { EXIT, type BrowserRunner } from "@tyto/core";
import type { ControlReply, ControlRequest } from "./control.ts";

export type LearnDeps = {
  spawnListener: (name: string, session: string) => Promise<void>;
  control: (name: string, req: ControlRequest) => Promise<ControlReply>;
  /** Runs the listener in this process (used by the detached `tyto learn --listen`). */
  listen?: (name: string, session: string) => Promise<number>;
};

type Io = { out: (line: string) => void; err: (line: string) => void };

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const READY_WAIT_MS = 15_000;

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function start(name: string, args: readonly string[], learn: LearnDeps, runner: BrowserRunner, io: Io): Promise<number> {
  const session = flag(args, "--session") ?? `learn-${name}`;
  await runner.run(["get", "url"], { session }); // make sure the session's daemon (and its event stream) is running
  await learn.spawnListener(name, session);
  const deadline = Date.now() + READY_WAIT_MS;
  for (;;) {
    try {
      const reply = await learn.control(name, { op: "status" });
      if (reply.ok) break;
    } catch (err) {
      if (Date.now() > deadline) {
        io.err(`the recorder did not start: ${err instanceof Error ? err.message : String(err)}`);
        return EXIT.internal;
      }
      await delay(100);
    }
  }
  io.out(`Recording "${name}" in agent-browser session ${session}.`);
  io.out(`Do the task with: agent-browser --session ${session} <command>   (or tyto open/click/fill … --session ${session})`);
  io.out(`See typed inputs: tyto learn status ${name}`);
  io.out(`Finish:           tyto learn stop ${name} --task "<what the task answers>" [--param input_N=name ...]`);
  return EXIT.hit;
}

async function stop(name: string, args: readonly string[], learn: LearnDeps, io: Io): Promise<number> {
  const task = flag(args, "--task");
  if (!task) {
    io.err(`usage: tyto learn stop ${name} --task "<what the task answers>" [--param input_N=name ...]`);
    return EXIT.usage;
  }
  const keep: Record<string, string> = {};
  args.forEach((a, i) => {
    if (a !== "--param") return;
    const m = /^(input_\d+)=(\w+)$/.exec(args[i + 1] ?? "");
    if (m?.[1] && m[2]) keep[m[1]] = m[2];
  });
  const reply = await learn.control(name, { op: "stop", task, keep });
  if (!reply.ok) {
    io.err(reply.error ?? "the recorder failed");
    return EXIT.internal;
  }
  io.out(`Saved trace ${reply.trace ?? name}: ${reply.steps ?? 0} steps${reply.lossy ? ` (lossy: ${reply.gaps?.join("; ")})` : ""}`);
  const params = Object.entries(reply.params ?? {});
  io.out(params.length ? `Params: ${params.map(([k, v]) => `${k} (example: ${v})`).join(", ")}` : "Params: none kept");
  return EXIT.hit;
}

async function status(name: string, learn: LearnDeps, io: Io): Promise<number> {
  const reply = await learn.control(name, { op: "status" });
  io.out(`Recording "${name}": ${reply.steps ?? 0} steps${reply.lossy ? " (lossy)" : ""}`);
  for (const i of reply.inputs ?? []) io.out(`  ${i.name.padEnd(9)} ${i.locator}${i.sensitive ? "   (secret: never kept)" : ""}`);
  if (!reply.inputs?.length) io.out("  no typed inputs yet");
  return EXIT.hit;
}

export async function learnCommand(args: readonly string[], learn: LearnDeps, runner: BrowserRunner, io: Io): Promise<number> {
  const [first, second] = args;
  try {
    if (first === "--listen" && second && learn.listen) return await learn.listen(second, flag(args, "--session") ?? `learn-${second}`);
    if (first === "stop" || first === "status") {
      if (!second || !NAME.test(second)) {
        io.err(`usage: tyto learn ${first} <name>`);
        return EXIT.usage;
      }
      return first === "stop" ? await stop(second, args.slice(2), learn, io) : await status(second, learn, io);
    }
    if (!first || !NAME.test(first)) {
      io.err("usage: tyto learn <name> [--session s]   (name: lowercase words joined by -)");
      return EXIT.usage;
    }
    return await start(first, args.slice(1), learn, runner, io);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return EXIT.usage;
  }
}
