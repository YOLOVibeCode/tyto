import { describe, expect, it } from "vitest";
import { nativePeerAllowed } from "../src/native-peer.ts";

describe("host native messaging", () => {
  it("host rejects native messages whose origin is not the Tyto extension id", () => {
    expect(nativePeerAllowed("abcdefghijklmnopqrstuvwxyzabcdef", "abcdefghijklmnopqrstuvwxyzabcdef")).toBe(true);
    expect(nativePeerAllowed("evil.extension.id.not.tyto.peer", "abcdefghijklmnopqrstuvwxyzabcdef")).toBe(false);
    expect(nativePeerAllowed("", "abcdefghijklmnopqrstuvwxyzabcdef")).toBe(false);
  });
});
