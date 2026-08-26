/** Composition root. Slice 7. Binds 127.0.0.1 only. */
export function assertNotImplemented(name: string): never {
  throw new Error(`${name} is not implemented yet — see docs/IMPLEMENTATION.md`);
}
