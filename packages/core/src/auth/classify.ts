import type { AuthEvidence, AuthProfile } from "../types.ts";
import type { AuthProfiler } from "../ports/auth-profiler.ts";

export class DefaultAuthProfiler implements AuthProfiler {
  identify(evidence: AuthEvidence): AuthProfile {
    if (evidence.wwwAuthenticateNegotiate) return { method: "negotiateIWA" };
    if (evidence.clientCert) return { method: "clientCert" };
    if (evidence.samlResponsePost) {
      return { method: "samlSso", ...(evidence.idpOrigin ? { idpOrigin: evidence.idpOrigin } : {}) };
    }
    if (evidence.oidcRedirect) {
      return { method: "oidc", ...(evidence.idpOrigin ? { idpOrigin: evidence.idpOrigin } : {}) };
    }
    if (evidence.authorizationBearer) return { method: "oauthBearer" };
    if (evidence.setCookie) return { method: "cookieSession" };
    return { method: "unknown" };
  }
}
