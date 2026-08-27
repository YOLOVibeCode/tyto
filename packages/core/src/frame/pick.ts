import type { Allowlist } from "../ports/allowlist.ts";
import type { FrameRef, FrameSnap } from "../types.ts";

const BANNER = /cookie|consent|recaptcha|captcha|onetrust/i;

export function pickWorkingDocument(frames: FrameSnap[], allow?: Allowlist): FrameRef | null {
  const eligible = frames.filter((f) => {
    if (!f.attached || f.reasonEmpty) return false;
    if (allow && !allow.permits(new URL(`${f.origin}/`))) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  const withRecipes = eligible.filter((f) => f.hasRecipes);
  if (withRecipes.length === 1) return withRecipes[0]!.ref;
  if (withRecipes.length > 1) {
    return [...withRecipes].sort((a, b) => b.axNodes - a.axNodes)[0]!.ref;
  }

  const apps = eligible.filter((f) => f.shape !== "shell" && !BANNER.test(f.origin + f.tree));
  if (apps.length === 1) return apps[0]!.ref;
  if (apps.length > 1) {
    const landmarked = apps.filter((f) => f.landmarks.length > 0);
    const pool = landmarked.length ? landmarked : apps;
    return [...pool].sort((a, b) => b.axNodes - a.axNodes)[0]!.ref;
  }

  const nonBanner = eligible.filter((f) => !BANNER.test(f.origin));
  const pool = nonBanner.length ? nonBanner : eligible;
  return [...pool].sort((a, b) => b.axNodes - a.axNodes)[0]!.ref;
}
