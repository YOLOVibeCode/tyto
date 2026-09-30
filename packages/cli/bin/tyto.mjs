#!/usr/bin/env node
// Runs the TypeScript sources directly (Node ≥ 22.18 strips types).
import { composeDeps, main } from "../src/index.ts";

const deps = await composeDeps();
process.exitCode = await main(process.argv.slice(2), deps);
