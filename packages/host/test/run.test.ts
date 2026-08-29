import { describe, expect, it } from "vitest";
import { DefaultConfirmGate, emptySession, SecretRedactor } from "@tyto/core";
import { makeLoopHarness, MemorySessionStore } from "@tyto/core/testing";
import { runnerMain } from "../src/run.ts";

describe("unattended runner CLI", () => {
  it("missing --session prints usage and exits 1", async () => {
    expect(await runnerMain([])).toBe(1);
  });

  it("session not found exits 1", async () => {
    expect(await runnerMain(["--session", "missing"], {}, { store: new MemorySessionStore() })).toBe(1);
  });

  it("without live ports exits 1", async () => {
    const store = new MemorySessionStore();
    await store.save(emptySession("s1", "x"));
    expect(await runnerMain(["--session", "s1"], {}, { store })).toBe(1);
  });

  it("injected ports: exit 0 on done", async () => {
    const h = makeLoopHarness();
    const session = emptySession("s0", "done");
    session.remainingSteps = [{ op: "done", reason: "ok" }];
    await h.store.save(session);
    const code = await runnerMain(["--session", "s0"], {}, {
      store: h.store,
      deps: {
        store: h.store,
        occupancy: h.occupancy,
        actuation: h.actuation,
        model: h.model,
        redactor: new SecretRedactor(),
        allowlist: h.allowlist,
        navigation: h.navigation,
        perception: h.perception,
        confirm: new DefaultConfirmGate(),
      },
    });
    expect(code).toBe(0);
  });
});
