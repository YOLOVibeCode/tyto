# Tyto extension (ATTACH)

Chrome + Edge MV3. Speaks **only** to the host via native messaging (hello for
loopback auth, CDP proxy for ATTACH). Auto-enables `chrome.debugger` on the
target tab.

`npm start` loads this unpacked dir into the Tyto profile and registers
`com.noctusoft.tyto` as a native host. The service worker seeds the host token
from hello; do not paste it into DevTools.

The document must not get a `window.tyto` command API.

See [docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md) Slice 11.
