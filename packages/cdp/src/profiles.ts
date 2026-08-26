import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileCatalog, ProfileRef } from "@tyto/core";
import { asRecord } from "./wire.ts";

export class LocalStateProfileCatalog implements ProfileCatalog {
  constructor(private readonly root: string) {}

  async list(browser: "chrome" | "edge"): Promise<ProfileRef[]> {
    const raw = JSON.parse(await readFile(await this.resolve(browser), "utf8")) as unknown;
    const cache = asRecord(asRecord(asRecord(raw)?.profile)?.info_cache);
    if (!cache) return [];
    const out: ProfileRef[] = [];
    for (const [directory, info] of Object.entries(cache)) {
      const name = asRecord(info)?.name;
      out.push({
        browser,
        directory,
        name: typeof name === "string" && name ? name : directory,
      });
    }
    return out;
  }

  private async resolve(browser: "chrome" | "edge"): Promise<string> {
    const fixture = join(this.root, `${browser}.json`);
    try {
      await access(fixture);
      return fixture;
    } catch {
      return join(this.root, "Local State");
    }
  }
}
