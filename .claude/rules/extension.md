# Extension (MV3)

Hand of the host. Native messaging only.

- No `window.tyto`. No page `postMessage` command channel.
- Ignore `fromPage` messages. Content scripts must not trigger CDP.
- Auto `chrome.debugger` on the chosen tab. No remotely hosted scripts. No `eval`.
