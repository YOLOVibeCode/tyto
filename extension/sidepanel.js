"use strict";
/**
 * Side panel UI script.
 * Communicates only via chrome.runtime.sendMessage → service worker.
 * Token is never in this DOM. No CDP. Page JS is data.
 */

const $ = (id) => document.getElementById(id);

let sessionId = null;
let scope = "tab"; /* "tab" | "all" */

/* ── RPC via service worker ───────────────────────────────────── */
async function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "rpc", method, params, id: crypto.randomUUID() },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error(resp?.error ?? "rpc failed"));
          return;
        }
        resolve(resp.result);
      },
    );
  });
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function appendMsg(role, text) {
  $("placeholder")?.remove();
  const transcript = $("transcript");
  const div = document.createElement("div");
  div.className = "msg " + role;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = role === "user" ? "You" : "Tyto";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  div.appendChild(label);
  div.appendChild(bubble);
  transcript.appendChild(div);
  transcript.scrollTop = transcript.scrollHeight;
}

/* ── model picker ─────────────────────────────────────────────── */
async function loadModels() {
  try {
    const result = await rpc("models.list");
    const sel = $("model");
    sel.innerHTML = "";
    const ids = result?.ids ?? [];
    if (ids.length === 0) {
      sel.innerHTML = '<option value="">no models</option>';
      return;
    }
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    /* restore persisted selection */
    chrome.storage.local.get(["lastModel"], (r) => {
      if (r.lastModel && ids.includes(r.lastModel)) sel.value = r.lastModel;
    });
  } catch (err) {
    $("model").innerHTML = '<option value="">unavailable</option>';
    setStatus("models.list failed: " + (err.message ?? err));
  }
}

$("model").onchange = () => {
  chrome.storage.local.set({ lastModel: $("model").value });
};

/* ── scope toggle ─────────────────────────────────────────────── */
function setScope(s) {
  scope = s;
  $("scope-tab").classList.toggle("active", s === "tab");
  $("scope-all").classList.toggle("active", s === "all");
  chrome.storage.local.set({ scope: s });
  if (s === "tab") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.runtime.sendMessage({ type: "scope:tab", tabId: tabs[0].id });
    });
  } else {
    chrome.runtime.sendMessage({ type: "scope:all" });
  }
}

$("scope-tab").onclick = () => setScope("tab");
$("scope-all").onclick = () => setScope("all");

/* restore persisted scope */
chrome.storage.local.get(["scope"], (r) => {
  if (r.scope === "all") setScope("all");
});

/* ── send ─────────────────────────────────────────────────────── */
async function resolveActiveOrigin() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url ?? "";
      try {
        resolve(new URL(url).origin);
      } catch {
        resolve("");
      }
    });
  });
}

async function doSend() {
  const text = ($("compose").value ?? "").trim();
  if (!text) return;
  const modelId = $("model").value ?? "";

  appendMsg("user", text);
  $("compose").value = "";
  setStatus("thinking…");
  $("send").disabled = true;

  try {
    if (!sessionId) {
      sessionId = "session-" + Date.now();
      await rpc("session.save", {
        session: {
          id: sessionId,
          goal: text,
          messages: [{ role: "user", content: text }],
          plan: null,
          recipes: [],
          answers: [],
          lastUrl: null,
          allowlist: [],
          model: { id: modelId, baseUrl: "" },
          vaultHandles: {},
          remainingSteps: [],
        },
      });
    } else {
      const current = await rpc("session.open", { id: sessionId });
      if (current) {
        current.messages = [...(current.messages ?? []), { role: "user", content: text }];
        if (modelId) current.model = { id: modelId, baseUrl: "" };
        await rpc("session.save", { session: current });
      }
    }

    const origin = scope === "tab" ? await resolveActiveOrigin() : await resolveActiveOrigin();
    if (origin) await rpc("operator.grantOrigin", { origin });
    await rpc("session.run", {
      id: sessionId,
      ...(origin ? { frame: { tabId: "t", frameId: "main", origin } } : {}),
    });
    const updated = await rpc("session.open", { id: sessionId });
    const msgs = updated?.messages ?? [];
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    if (last) appendMsg("assistant", last.content);
    setStatus("");
  } catch (err) {
    setStatus(err.message ?? String(err));
  } finally {
    $("send").disabled = false;
  }
}

$("send").onclick = doSend;
$("compose").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    doSend();
  }
};

/* ── stop ─────────────────────────────────────────────────────── */
$("stop").onclick = async () => {
  try {
    await rpc("operator.interrupt");
    setStatus("stopped");
  } catch (err) {
    setStatus(err.message ?? String(err));
  }
};

/* ── init ─────────────────────────────────────────────────────── */
loadModels();
