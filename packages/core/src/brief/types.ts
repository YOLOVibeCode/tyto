export type ConsoleEntry = { type: string; text: string };
export type ErrorEntry = { text: string; url?: string | null; line?: number; column?: number };
export type RequestEntry = {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  resourceType?: string;
  mimeType?: string;
};
/** Raw cookie as agent-browser reports it. `value` is never copied into a brief. */
export type CookieEntry = {
  name: string;
  domain?: string;
  httpOnly?: boolean;
  secure?: boolean;
  expires?: number;
  session?: boolean;
  value?: string;
};
export type PageFacts = {
  framework: string[];
  status: number | null;
  dclMs: number;
  loadMs: number;
  headings: string[];
  forms: number;
  iframes: number;
  text: string;
};
/** Log lengths when the current page was opened; entries before these offsets belong to earlier pages. */
export type LogCounts = { console: number; errors: number; requests: number };

export type BriefInput = {
  url: string;
  title: string;
  snapshot: string;
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  requests: RequestEntry[];
  cookies: CookieEntry[];
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
  page: PageFacts;
  /** Response bodies of failed Fetch/XHR requests, by requestId. */
  bodies: Record<string, string>;
  mark: LogCounts;
  /** Epoch milliseconds, for cookie lifetimes. */
  now: number;
};

export type BriefCookie = { name: string; domain: string; httpOnly: boolean; lifetime: string };

export type Brief = {
  url: string;
  title: string;
  status: number | null;
  framework: string[];
  timing: { dclMs: number; loadMs: number };
  forms: number;
  iframes: number;
  issues: string[];
  network: { total: number; byType: Record<string, number>; failed: number; api: string[] };
  cookies: BriefCookie[];
  storage: { local: number; session: number };
  outline: string[];
  elements: string[];
  elementsTotal: number;
  text: string;
};
