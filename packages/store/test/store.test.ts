import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe } from "@tyto/core";
import { FileSessionLock, FilesystemRecipeStore, ensureReplayFiles } from "../src/index.ts";

function recipe(name = "release", overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe({
    name,
    version: 1,
    status: "draft",
    intent: "Newest release tag.",
    origins: ["https://github.com"],
    params: { repo: { type: "string", description: "owner/name", example: "a/b" } },
    steps: [["open", "https://github.com/{{repo|path}}/releases"], ["eval", "JSON.stringify({ tag: 'v1' })"]],
    verify: { required: ["tag"] },
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tyto-store-"));
}

describe("FilesystemRecipeStore", () => {
  it("writes atomically with mode 0600 and rejects invalid recipes", async () => {
    const dir = join(await tmp(), "recipes");
    const store = new FilesystemRecipeStore(dir);
    await store.save(recipe());
    expect((await stat(join(dir, "release.json"))).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const bad = recipe("bad", { steps: [["open", "https://github.com/"], ["cookies", "clear"], ["eval", "JSON.stringify({})"]] });
    await expect(store.save(bad)).rejects.toThrow(/lint/);
    expect(await store.get("bad")).toBeNull();
  });

  it("list returns name, intent, params, status, and auth", async () => {
    const store = new FilesystemRecipeStore(join(await tmp(), "recipes"));
    await store.save(recipe());
    expect(await store.list()).toEqual([{ name: "release", intent: "Newest release tag.", params: ["repo"], status: "draft", auth: false }]);
  });

  it("get returns null for an unknown recipe and round-trips a saved one", async () => {
    const store = new FilesystemRecipeStore(join(await tmp(), "recipes"));
    expect(await store.get("nope")).toBeNull();
    await store.save(recipe());
    expect(await store.get("release")).toEqual(recipe());
  });

  it("get refuses names that are not kebab-case", async () => {
    const store = new FilesystemRecipeStore(join(await tmp(), "recipes"));
    await expect(store.get("../../etc/passwd")).rejects.toThrow(/name/);
  });

  it("remove deletes a recipe and reports whether it existed", async () => {
    const store = new FilesystemRecipeStore(join(await tmp(), "recipes"));
    await store.save(recipe());
    expect(await store.remove("release")).toBe(true);
    expect(await store.remove("release")).toBe(false);
  });
});

describe("FileSessionLock", () => {
  it("gives the lock to one holder at a time", async () => {
    const lock = new FileSessionLock(await tmp());
    const first = await lock.acquire("tyto-rx", 0);
    expect(first).not.toBeNull();
    expect(await lock.acquire("tyto-rx", 50)).toBeNull();
    await first?.();
    const again = await lock.acquire("tyto-rx", 0);
    expect(again).not.toBeNull();
    await again?.();
  });

  it("reclaims a lock whose holder process is gone", async () => {
    const dir = await tmp();
    await writeFile(join(dir, "tyto-rx.lock"), JSON.stringify({ pid: 999_999_999, at: 0 }));
    const release = await new FileSessionLock(dir).acquire("tyto-rx", 0);
    expect(release).not.toBeNull();
    await release?.();
  });
});

describe("ensureReplayFiles", () => {
  it("writes a Tyto agent-browser config with only executablePath and a policy denying download and upload", async () => {
    const home = await tmp();
    const userConfig = join(home, "user-config.json");
    await writeFile(userConfig, JSON.stringify({ restore: "main", executablePath: "/Applications/Edge", headed: true }));
    const paths = await ensureReplayFiles(join(home, "tyto"), userConfig);
    expect(JSON.parse(await readFile(paths.config, "utf8"))).toEqual({ executablePath: "/Applications/Edge" });
    expect(JSON.parse(await readFile(paths.policy, "utf8"))).toEqual({ default: "allow", deny: ["download", "upload"] });
    expect((await stat(paths.config)).mode & 0o777).toBe(0o600);
  });

  it("writes an empty config when the user has no agent-browser config", async () => {
    const home = await tmp();
    const paths = await ensureReplayFiles(join(home, "tyto"), join(home, "missing.json"));
    expect(JSON.parse(await readFile(paths.config, "utf8"))).toEqual({});
  });
});
