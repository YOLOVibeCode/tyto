import { runNativeStdio } from "./native-host.ts";

const authPath = process.env.TYTO_NATIVE_AUTH ?? "";
if (!authPath) {
  process.stderr.write("TYTO_NATIVE_AUTH missing\n");
  process.exit(1);
}

await runNativeStdio({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  authPath,
});
