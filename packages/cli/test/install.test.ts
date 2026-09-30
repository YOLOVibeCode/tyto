import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, install, type DoctorDeps } from "../src/index.ts";

const RULE = `# Web access: use the fastest tool that can do the job

1. **Public data with an API**: call the API.
2. **Static public page, read-only**: WebFetch.
3. **Use \`agent-browser\`** when …
4. **Repeats**: if a site task will run again or over many inputs, once it works save the exact
   \`agent-browser\` commands as a script with the inputs as parameters (\`agent-browser batch …\`), verify its
   output, and run the script next time instead of browsing. Fall back to browsing only if it fails.
5. **Inside agent-browser**: one \`--session\` per task.
`;

async function home(): Promise<string> {
  const h = await mkdtemp(join(tmpdir(), "tyto-home-"));
  await mkdir(join(h, ".claude", "rules"), { recursive: true });
  await mkdir(join(h, ".cursor", "rules"), { recursive: true });
  await writeFile(join(h, ".claude", "rules", "web-access.md"), RULE);
  await writeFile(join(h, ".cursor", "rules", "web-access.mdc"), `---\nalwaysApply: true\n---\n\n${RULE}`);
  return h;
}

function io() {
  const lines: string[] = [];
  return { lines, out: (s: string) => lines.push(s), err: (s: string) => lines.push(`ERR ${s}`) };
}

const OPTS = { nodePath: "/opt/node26/bin/node", cliBin: "/src/tyto/packages/cli/bin/tyto.mjs" };

describe("tyto install", () => {
  it("writes the tyto launcher into the bin dir, pinned to this Node", async () => {
    const h = await home();
    await install({ ...OPTS, home: h, binDir: join(h, ".local", "bin") }, io());
    const launcher = await readFile(join(h, ".local", "bin", "tyto"), "utf8");
    expect(launcher).toContain('"/opt/node26/bin/node" "/src/tyto/packages/cli/bin/tyto.mjs"');
    expect((await stat(join(h, ".local", "bin", "tyto"))).mode & 0o111).not.toBe(0);
  });

  it("install writes the tyto skill for Claude Code and Cursor", async () => {
    const h = await home();
    await install({ ...OPTS, home: h, binDir: join(h, "bin") }, io());
    for (const dir of [".claude", ".cursor"]) {
      const skill = await readFile(join(h, dir, "skills", "tyto", "SKILL.md"), "utf8");
      expect(skill).toMatch(/^---\nname: tyto/);
      expect(skill).toMatch(/tyto recipes/);
      expect(skill).toMatch(/tyto learn/);
    }
  });

  it("install does not overwrite a skill the user edited", async () => {
    const h = await home();
    const o = io();
    await install({ ...OPTS, home: h, binDir: join(h, "bin") }, o);
    const path = join(h, ".claude", "skills", "tyto", "SKILL.md");
    await writeFile(path, "my own notes");
    await install({ ...OPTS, home: h, binDir: join(h, "bin") }, o);
    expect(await readFile(path, "utf8")).toBe("my own notes");
    expect(o.lines.join("\n")).toMatch(/kept your edited/);
  });

  it("install updates the web-access rule to check tyto recipes first, once", async () => {
    const h = await home();
    await install({ ...OPTS, home: h, binDir: join(h, "bin") }, io());
    await install({ ...OPTS, home: h, binDir: join(h, "bin") }, io());
    for (const f of [join(h, ".claude", "rules", "web-access.md"), join(h, ".cursor", "rules", "web-access.mdc")]) {
      const text = await readFile(f, "utf8");
      expect(text).toMatch(/4\. \*\*Repeats\*\*: check `tyto recipes`/);
      expect(text.match(/tyto recipes/g)?.length).toBe(1);
      expect(text).toMatch(/5\. \*\*Inside agent-browser\*\*/);
      expect(text).not.toMatch(/agent-browser batch …/);
    }
  });
});

function doctorDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: "26.9.0",
    agentBrowserVersion: async () => "0.38.1",
    claudeVersion: async () => "2.1.285",
    launcher: async () => "/home/u/.local/bin/tyto",
    sessions: async () => [{ session: "tyto-rx", pid: 42, version: "0.38.1" }],
    closeSession: async () => undefined,
    ...overrides,
  };
}

describe("tyto doctor", () => {
  it("reports all clear on a healthy setup", async () => {
    const o = io();
    expect(await doctor([], doctorDeps(), o)).toBe(0);
    expect(o.lines.join("\n")).toMatch(/agent-browser 0\.38\.1/);
  });

  it("doctor reports an agent-browser older than 0.38.1", async () => {
    const o = io();
    expect(await doctor([], doctorDeps({ agentBrowserVersion: async () => "0.37.9" }), o)).toBe(1);
    expect(o.lines.join("\n")).toMatch(/agent-browser 0\.37\.9 .*0\.38\.1/);
  });

  it("doctor reports a missing agent-browser and a missing launcher", async () => {
    const o = io();
    await doctor([], doctorDeps({ agentBrowserVersion: async () => null, launcher: async () => null }), o);
    const text = o.lines.join("\n");
    expect(text).toMatch(/brew install agent-browser/);
    expect(text).toMatch(/tyto install/);
  });

  it("doctor --fix closes Tyto's running sessions so they restart with Tyto's settings", async () => {
    const closed: string[] = [];
    const o = io();
    await doctor(["--fix"], doctorDeps({ closeSession: async (s) => void closed.push(s) }), o);
    expect(closed).toEqual(["tyto-rx"]);
  });
});
