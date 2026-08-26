import { describe, expect, it } from "vitest";
import { OriginAllowlist } from "../src/policy/allow.ts";
import { DefaultConfirmGate } from "../src/policy/confirm.ts";
import { LoopbackBindPolicy } from "../src/policy/bind-loopback.ts";
import { ExplicitProfileGuard } from "../src/policy/profile.ts";

describe("policy", () => {
  it("allowlist default-deny: https://evil.test blocked", () => {
    const a = new OriginAllowlist();
    expect(a.permits(new URL("https://evil.test/x"))).toBe(false);
  });

  it("grant origin then permits path on that origin", () => {
    const a = new OriginAllowlist();
    a.grant("https://en.wikipedia.org");
    expect(a.permits(new URL("https://en.wikipedia.org/wiki/Barn_owl"))).toBe(true);
    expect(a.permits(new URL("https://evil.test/"))).toBe(false);
  });

  it("iframe discovery does not call Allowlist.grant", () => {
    const a = new OriginAllowlist();
    const grants: string[] = [];
    const orig = a.grant.bind(a);
    a.grant = (o) => {
      grants.push(o);
      orig(o);
    };
    expect(a.permits(new URL("https://wd5.myworkday.com/"))).toBe(false);
    expect(grants).toEqual([]);
  });

  it("submit / purchase / delete / send require confirm", () => {
    const g = new DefaultConfirmGate();
    expect(g.mustConfirm({ kind: "submit" })).toBe("submit");
    expect(g.mustConfirm({ kind: "purchase" })).toBe("purchase");
    expect(g.mustConfirm({ kind: "delete" })).toBe("delete");
    expect(g.mustConfirm({ kind: "send" })).toBe("send");
  });

  it("click on a link does not require confirm", () => {
    expect(new DefaultConfirmGate().mustConfirm({ kind: "click" })).toBeNull();
  });

  it("ProfileGuard throws if launch attempted without explicit pick when catalog is non-empty", () => {
    const g = new ExplicitProfileGuard(3);
    expect(() => g.assertExplicitPick({ browser: "chrome", directory: "", name: "" })).toThrow(/profile pick/);
  });

  it("BindPolicy rejects 0.0.0.0 and ::", () => {
    const b = new LoopbackBindPolicy();
    expect(() => b.assertLoopback("0.0.0.0")).toThrow();
    expect(() => b.assertLoopback("::")).toThrow();
  });

  it("BindPolicy accepts 127.0.0.1", () => {
    expect(() => new LoopbackBindPolicy().assertLoopback("127.0.0.1")).not.toThrow();
  });
});
