# CDP (`@tyto/cdp`)

Playwright is forbidden in this package.

- `--remote-debugging-address=127.0.0.1`. Connect `/json/version`.
- AX per frame; `Target.setAutoAttach` for OOPIFs.
- Click: box model + `Input.dispatchMouseEvent` on the **focused frame session**.
  Not `Runtime.evaluate("el.click()")`. Not parent coordinates into a child iframe.
- Debugger stepping off. Cookies via `Network.getAllCookies`, never `document.cookie`.
- Do not log `Set-Cookie` values. No OS Kerberos ticket extraction.
