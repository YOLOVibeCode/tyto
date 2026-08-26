import { describe, expect, it } from "vitest";
import { pickWorkingDocument } from "../src/frame/pick.ts";
import type { FrameSnap } from "../src/types.ts";

const parent: FrameSnap = {
  ref: { tabId: "t", frameId: "p", origin: "https://hr.example.edu" },
  origin: "https://hr.example.edu",
  attached: true,
  shape: "shell",
  axNodes: 12,
  tree: "banner Jump to content",
  hasRecipes: false,
  landmarks: [],
};

const child: FrameSnap = {
  ref: { tabId: "t", frameId: "c", origin: "https://wd5.myworkday.com" },
  origin: "https://wd5.myworkday.com",
  attached: true,
  shape: "injected",
  axNodes: 400,
  tree: "main Search Worker",
  hasRecipes: true,
  landmarks: ["main"],
};

describe("hosted app frame graph", () => {
  it("list frames: unattached child is not picked", () => {
    const unattached = { ...child, attached: false, reasonEmpty: "oopif" };
    expect(pickWorkingDocument([parent, unattached])).toEqual(parent.ref);
  });

  it("pickWorkingDocument prefers injected tenant over parent shell", () => {
    expect(pickWorkingDocument([parent, child])?.frameId).toBe("c");
  });

  it("pickWorkingDocument returns none if no attached frames", () => {
    expect(pickWorkingDocument([{ ...parent, attached: false, reasonEmpty: "x" }])).toBeNull();
  });

  it("never prefer a cookie-banner frame over a tenant with application landmarks", () => {
    const banner: FrameSnap = {
      ref: { tabId: "t", frameId: "b", origin: "https://consent.cookie.test" },
      origin: "https://consent.cookie.test",
      attached: true,
      shape: "static",
      axNodes: 900,
      tree: "cookie consent accept",
      hasRecipes: false,
      landmarks: [],
    };
    expect(pickWorkingDocument([banner, child])?.frameId).toBe("c");
  });
});
