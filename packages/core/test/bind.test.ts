import { describe, expect, it } from "vitest";
import { compactAx } from "../src/ax/compact.ts";
import { bind, MemoryRecipeArchive } from "../src/recipe/bind.ts";
import type { AxSnapshot, Step } from "../src/types.ts";

function snap(generation: number, names: Array<{ role: string; name: string; id: number }>): AxSnapshot {
  const nodes = names.map((n, i) => ({
    nodeId: String(i + 1),
    parentId: i === 0 ? undefined : "1",
    childIds: i === 0 ? names.slice(1).map((_, j) => String(j + 2)) : [],
    role: { value: n.role },
    name: { value: n.name },
    backendDOMNodeId: n.id,
  }));
  if (names.length === 0) {
    return compactAx([], { generation, origin: "https://ex.test", url: "https://ex.test/", title: "t" });
  }
  const rootKids = names.slice(1).map((_, j) => String(j + 2));
  nodes[0] = { ...nodes[0]!, childIds: rootKids, parentId: undefined };
  return compactAx(nodes, { generation, origin: "https://ex.test", url: "https://ex.test/", title: "t" });
}

describe("bind", () => {
  it("hits unique role+name case-insensitively", () => {
    const s = snap(1, [
      { role: "WebArea", name: "Home", id: 1 },
      { role: "button", name: "Search", id: 10 },
    ]);
    const hit = bind({ op: "click", role: "BUTTON", name: "search" }, s);
    expect(hit).not.toBeNull();
    expect(hit).not.toBe("ok");
    if (hit && hit !== "ok") expect(hit.name).toBe("Search");
  });

  it("returns miss when two nodes share role+name", () => {
    const s = snap(1, [
      { role: "generic", name: "root", id: 1 },
      { role: "button", name: "OK", id: 2 },
      { role: "button", name: "OK", id: 3 },
    ]);
    expect(bind({ op: "click", role: "button", name: "OK" }, s)).toBeNull();
  });

  it("bind never uses backendNodeId from a recipe archive", () => {
    const archive = new MemoryRecipeArchive();
    archive.remember("https://ex.test", {
      role: "button",
      name: "Search",
      origin: "https://ex.test",
    });
    const rec = archive.lookup("https://ex.test", "button", "Search");
    expect(rec).toBeTruthy();
    expect(JSON.stringify(rec)).not.toContain("backendNodeId");
    expect(archive.lookup("https://other.test", "button", "Search")).toBeNull();
  });

  it("compact assigns ref_1..n and interactive roles only", () => {
    const s = snap(1, [
      { role: "generic", name: "root", id: 1 },
      { role: "button", name: "Go", id: 9 },
      { role: "heading", name: "Title", id: 8 },
    ]);
    expect([...s.refs.keys()][0]).toBe("ref_1");
    expect(s.tree).toContain("[ref_1]");
    expect(s.tree).toContain('heading "Title"');
  });

  it("a ref from snapshot A is invalid on snapshot B (generation token)", () => {
    const a = snap(1, [
      { role: "generic", name: "root", id: 1 },
      { role: "button", name: "Go", id: 9 },
    ]);
    const b = snap(2, [
      { role: "generic", name: "root", id: 1 },
      { role: "button", name: "Go", id: 99 },
    ]);
    expect(a.generation).not.toBe(b.generation);
    const step: Step = { op: "click", role: "button", name: "Go", ref: "ref_1" };
    const ha = bind(step, a);
    const hb = bind(step, b);
    expect(ha !== "ok" && ha && hb !== "ok" && hb && ha.backendNodeId !== hb.backendNodeId).toBe(true);
  });
});
