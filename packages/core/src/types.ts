export type SessionId = string;
export type Origin = string;
export type TabId = string;
export type FrameId = string;
export type BackendNodeId = number;
export type Ms = number;
export type SecretRef = string;
export type ModelId = string;
export type VaultHandle = string;
export type Unsubscribe = () => void;

export type DocShape = "static" | "shell" | "injected";

export type AuthMethod =
  | "cookieSession"
  | "oauthBearer"
  | "samlSso"
  | "oidc"
  | "negotiateIWA"
  | "clientCert"
  | "unknown";

export type BundleStatus = "fresh" | "expiring" | "expired" | "none";

export type ConfirmReason = "submit" | "purchase" | "delete" | "send" | "identity-capture" | "identity-restore";

export type Recipe = {
  role: string;
  name: string;
  landmark?: string;
  origin: Origin;
  routePattern?: string;
};

export type RecipeHit = Recipe & { ref: string; backendNodeId: BackendNodeId };

export type RefEntry = {
  ref: string;
  role: string;
  name: string;
  backendNodeId: BackendNodeId;
};

export type AxSnapshot = {
  generation: number;
  origin: Origin;
  url: string;
  title: string;
  tree: string;
  refs: Map<string, RefEntry>;
  recipes: RecipeHit[];
};

export type FrameRef = { tabId: TabId; frameId: FrameId; origin: Origin };

export type FrameNode = {
  ref: FrameRef;
  origin: Origin;
  parent?: FrameId;
  attached: boolean;
  reasonEmpty?: string;
};

export type FrameSnap = {
  ref: FrameRef;
  origin: Origin;
  attached: boolean;
  reasonEmpty?: string;
  shape: DocShape;
  axNodes: number;
  tree: string;
  hasRecipes: boolean;
  landmarks: string[];
};

export type DocStats = {
  textLen: number;
  elements: number;
  tables: number;
  mainLen: number;
  axNodes: number;
  shape: DocShape;
  shellMarker: boolean;
};

export type Step =
  | { op: "click"; role: string; name: string; ref?: string }
  | { op: "fill"; role: string; name: string; text: string; ref?: string }
  | { op: "press"; key: string }
  | { op: "extract"; query: string }
  | { op: "done"; reason: string };

export type Plan = { anchors: Array<{ id: string; role: string; name: string }>; steps: Step[]; rationale: string };

export type Intent = {
  kind: "click" | "fill" | "press" | "goto" | "submit" | "purchase" | "delete" | "send";
  url?: string;
  role?: string;
  name?: string;
};

export type TrustedIntent = {
  op: "click" | "fill" | "press" | "insertText" | "scroll";
  node?: BackendNodeId;
  text?: string;
  key?: string;
  frame: FrameRef;
};

export type TapeKind = "console" | "exception" | "nav" | "spa" | "lifecycle" | "network" | "jsctx" | "dom" | "frame";

export type TapeEvent = {
  t: number;
  kind: TapeKind;
  detail: string;
  url?: string;
};

export type UntrustedDocument = { kind: "untrusted"; text: string };

export type CompleteRequest = {
  system: string;
  user: string;
  page?: UntrustedDocument;
};

export type CompleteResponse = { text: string };

export type Message = { role: "user" | "assistant" | "system"; content: string };

export type Session = {
  id: SessionId;
  goal: string;
  messages: Message[];
  plan: Plan | null;
  recipes: Recipe[];
  answers: string[];
  lastUrl: string | null;
  allowlist: Origin[];
  model: { id: string; baseUrl: string };
  vaultHandles: Record<Origin, VaultHandle>;
  remainingSteps: Step[];
};

export type SessionSummary = { id: SessionId; goal: string; lastUrl: string | null };

export type ProfileRef = { browser: "chrome" | "edge"; directory: string; name: string };

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; reason: "shell" | "miss" };

export type AuthEvidence = {
  setCookie?: boolean;
  authorizationBearer?: boolean;
  samlResponsePost?: boolean;
  oidcRedirect?: boolean;
  wwwAuthenticateNegotiate?: boolean;
  clientCert?: boolean;
  idpOrigin?: Origin;
};

export type AuthProfile = {
  method: AuthMethod;
  idpOrigin?: Origin;
  expiryHint?: Date;
};

export type RawCookie = { name: string; value: string; domain: string; path: string; httpOnly: boolean; secure: boolean };

export type RawStorageItems = { localStorage: Record<string, string>; sessionStorage: Record<string, string>; indexedDb: Record<string, string> };

export type AxNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
};
