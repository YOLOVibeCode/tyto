import type { BundleStatus } from "../types.ts";
import type { Clock } from "../ports/clock.ts";

export type ExpiryBundle = { capturedAt: number; expiryHint?: number };

const EXPIRING_WINDOW_MS = 10 * 60 * 1000;

export function bundleStatus(bundle: ExpiryBundle | null, clock: Clock): BundleStatus {
  if (!bundle) return "none";
  const now = clock.now();
  if (bundle.expiryHint != null && now >= bundle.expiryHint) return "expired";
  if (bundle.expiryHint != null && bundle.expiryHint - now <= EXPIRING_WINDOW_MS) return "expiring";
  return "fresh";
}
