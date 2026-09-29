# Spike: your own AI browser from the command line

Throwaway proof of concept (not product code; see `docs/IMPLEMENTATION.md` for the product laws).
Question it answers: *can any language model drive a page, with full visibility and no browser
extension, at native-CLI speed?* It is a thin layer (`tyto`, Python) over
[agent-browser](https://github.com/vercel-labs/agent-browser), which launches its own Chrome for Testing.

| File | What |
|---|---|
| `tyto` | The CLI: persistent own profile, one-call BRIEF, "what happened" after every action, masked cookies, page-text `find` |
| `card.md` | The ~300-token instructions every model gets (instead of a 37 KB skill) |
| `agent.py` | Minimal model-agnostic agent loop: any OpenAI-compatible model + one `tyto` tool |
| `fixture.py` | Local test site with planted problems (500 API, JS TypeError, login) |
| `matrix.py`, `retest.py` | The graded model matrix |

## Run it

```bash
brew install agent-browser && agent-browser install      # own Chrome for Testing, no extension
python3 spikes/own-browser/fixture.py 8765 &               # optional test site
export TYTO_HOME=/tmp/tyto-poc-home
spikes/own-browser/tyto start
spikes/own-browser/tyto open http://127.0.0.1:8765/shop  # prints the BRIEF
spikes/own-browser/agent.py gpt-oss:20b "The page http://127.0.0.1:8765/shop shows 'No items'. Why?"
```

## Results (2026-09-29, M4 Max, agent-browser 0.38.1, Chrome for Testing 154)

1. **Own browser, no extension** — ✅ `tyto start` launches its own Chrome with a persistent profile: 0.6–1.6 s.
2. **Stays logged in** — ✅ Logged in, fully quit Chrome (processes gone), restarted: still logged in, on the local
   fixture (session-only and 30-day cookies) and on a real site (the-internet.herokuapp.com, `rack.session` cookie).
3. **Full visibility in one call** — ✅ `tyto open` returns status, failed requests with response body, JS exceptions
   with source location, console errors, API calls, cookies (masked), storage, outline, interactive refs, and text.
   143–711 tokens; gathered in 0.08–0.6 s. Every action prints what happened (navigation, requests, errors).
4. **Any model** — ✅ Same card, same tasks, graded:

   | Task | gpt-oss 20B (local) | Qwen3-coder 30B (local) | Claude Sonnet + tyto | Claude + plain agent-browser |
   |---|---|---|---|---|
   | Debug "No items" page | 3/3 · 2 turns · 3.2–4.8 s | 3/3 · 2 turns · 2.9–13.4 s | 2/2 · 2 turns · 5.7 s | 2/2 · 7–8 turns · 13.9–17.9 s |
   | Debug Save button | 2/2 · 7.4 s (one 102 s outlier) | 2/2 · 5.8–7.5 s | 2/2 · 10.7–11.6 s | 2/2 · 10.1–13.3 s |
   | Log in | 3/3 · 6.7–7.5 s | 3/3 · 6.0 s | 2/2 · 10.1 s | — |
   | Wikipedia fact, before `find` | 0/2 | 1/2 | 2/2 | — |
   | Wikipedia fact, with `find` | 3/3 · 3 turns · 5.3–5.5 s | 3/3 · 18–22 s | — | — |

5. **Native feel** — ✅ cold start 0.77 s · open+brief 0.98 s (local) / 1.71 s (Wikipedia) · brief alone 0.16–0.62 s ·
   raw command 0.1 s · click + feedback 0.47 s. Compiled recipes (earlier test): 0.23–0.31 s warm, no model.

## Findings

- The BRIEF turns "why is this broken?" into **one command** for every model tested, including a local 20B model
  (2 turns vs 7–8 turns pulling console/network/errors separately).
- Weak models need a page-text search (`find`), not bigger briefs: it fixed the only failing category.
- agent-browser 0.38.1 bug: `errors --clear` does not clear the error buffer (worked around with offsets). Report upstream.
- Session-only cookies survived a full restart with a persistent profile; do not rely on that for every site.
- Open time includes a ~0.5 s "network quiet" wait; can be made event-driven.
- Refs written without `@` (Qwen) are now accepted.

Not tested: heavy SPAs, iframes/OOPIFs, sites with bot protection, Windows/Linux, long sessions, concurrency.
