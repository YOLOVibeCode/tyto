import type { RequestEntry } from "./types.ts";

export function originOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(url);
  return m ? m[0] : "";
}

export function shortUrl(url: string, origin: string): string {
  return origin && url.startsWith(origin) ? url.slice(origin.length) || "/" : url;
}

export function isNoise(req: RequestEntry): boolean {
  return /\/favicon\.ico(?:$|\?)/.test(req.url);
}

export function isApi(req: RequestEntry): boolean {
  return req.resourceType === "Fetch" || req.resourceType === "XHR";
}
