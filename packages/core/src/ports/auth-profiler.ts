import type { AuthEvidence, AuthProfile } from "../types.ts";

export interface AuthProfiler {
  identify(evidence: AuthEvidence): AuthProfile;
}
