import { LoopbackBindPolicy, type LaunchOpts } from "@tyto/core";

export function chromeLaunchArgs(opts: LaunchOpts): string[] {
  new LoopbackBindPolicy().assertLoopback(opts.bindHost);
  const args = [
    `--user-data-dir=${opts.userDataDir}`,
    `--remote-debugging-port=${String(opts.port)}`,
    `--remote-debugging-address=${opts.bindHost}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (opts.authServerAllowlist?.length) {
    args.push(`--auth-server-allowlist=${opts.authServerAllowlist.join(",")}`);
  }
  return args;
}
