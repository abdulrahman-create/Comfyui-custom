// Find & Replace Pixaroma - state + replace logic + word-diff.
//
// State lives on node.properties.findReplaceState:
//   { version:1, caseSensitive, wholeWord, regex, tidy, rules:[{id,enabled,find,replace}] }
// LiteGraph serializes node.properties natively. The graphToPrompt hook in
// index.js packs this (minus the preview) into the hidden FindReplaceState input.
//
// The on-node preview is driven by applyRulesJS(), a 1:1 mirror of
// nodes/node_find_replace.py::_apply_rules. Python is authoritative; literal
// mode is exact, regex backrefs differ in syntax (\1 Python / $1 JS) and JS
// converts them best-effort.

export const STATE_PROP = "findReplaceState";
export const PREVIEW_PROP = "findReplacePreview";

let _idCounter = 0;
function nextId() {
  _idCounter += 1;
  return `fr${Date.now().toString(36)}_${_idCounter}`;
}

export function freshRule(overrides = {}) {
  return { id: nextId(), enabled: true, find: "", replace: "", ...overrides };
}

export function defaultState() {
  return {
    version: 1,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    tidy: true,
    rules: [freshRule()],
  };
}

export function readState(node) {
  const s = node.properties?.[STATE_PROP];
  if (!s || typeof s !== "object") return defaultState();
  if (!Array.isArray(s.rules) || s.rules.length === 0) return defaultState();
  if (typeof s.caseSensitive !== "boolean") s.caseSensitive = false;
  if (typeof s.wholeWord !== "boolean") s.wholeWord = false;
  if (typeof s.regex !== "boolean") s.regex = false;
  if (typeof s.tidy !== "boolean") s.tidy = true;
  for (const row of s.rules) {
    if (typeof row.id !== "string" || !row.id) row.id = nextId();
    if (typeof row.enabled !== "boolean") row.enabled = true;
    if (typeof row.find !== "string") row.find = "";
    if (typeof row.replace !== "string") row.replace = "";
  }
  return s;
}

export function writeState(node, state) {
  node.properties = node.properties || {};
  node.properties[STATE_PROP] = state;
}

export function restoreFromProperties(node) {
  writeState(node, readState(node));
}

// ---- mutators -------------------------------------------------------------

export function addRule(node) {
  const state = readState(node);
  state.rules.push(freshRule());
  writeState(node, state);
}

export function deleteRule(node, id) {
  const state = readState(node);
  if (state.rules.length <= 1) return;
  state.rules = state.rules.filter((r) => r.id !== id);
  writeState(node, state);
}

export function toggleRuleEnabled(node, id) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.enabled = !row.enabled;
  writeState(node, state);
}

export function setFind(node, id, v) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.find = String(v || "");
  writeState(node, state);
}

export function setReplace(node, id, v) {
  const state = readState(node);
  const row = state.rules.find((r) => r.id === id);
  if (row) row.replace = String(v || "");
  writeState(node, state);
}

export function setToggle(node, key) {
  const state = readState(node);
  if (key in state) state[key] = !state[key];
  writeState(node, state);
}

export function reorderRules(node, fromIdx, toIdx) {
  const state = readState(node);
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= state.rules.length) return;
  if (toIdx < 0 || toIdx >= state.rules.length) return;
  const [moved] = state.rules.splice(fromIdx, 1);
  state.rules.splice(toIdx, 0, moved);
  writeState(node, state);
}

export function resetToDefault(node) {
  writeState(node, defaultState());
}

// ---- preview persistence --------------------------------------------------
// Stored separately from the rules state so it is NOT injected into the prompt.

export function getPreviewInput(node) {
  const p = node.properties?.[PREVIEW_PROP];
  if (!p || typeof p !== "object" || typeof p.input !== "string") return null;
  return p;
}

export function setPreviewInput(node, input, truncated) {
  node.properties = node.properties || {};
  node.properties[PREVIEW_PROP] = {
    input: String(input == null ? "" : input),
    truncated: !!truncated,
  };
}

// ---- replace logic (mirror of node_find_replace.py::_apply_rules) ---------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tidy(s) {
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]+,/g, ",");
  s = s.replace(/,(?:[ \t]*,)+/g, ",");
  s = s.replace(/[ \t]+(\r?\n)/g, "$1");
  s = s.replace(/^[ \t]*,[ \t]*/, "");
  s = s.replace(/,[ \t]*$/, "");
  return s.trim();
}

// Returns { output, warnings:[string] }.
export function applyRulesJS(text, state) {
  const rules = Array.isArray(state.rules) ? state.rules : [];
  const cs = !!state.caseSensitive;
  const ww = !!state.wholeWord;
  const rx = !!state.regex;
  const td = state.tidy !== false;
  const warnings = [];
  let out = String(text == null ? "" : text);
  const flags = "g" + (cs ? "" : "i");

  rules.forEach((rule, idx) => {
    if (!rule || rule.enabled === false) return;
    const find = rule.find || "";
    if (!find) return;
    const repl = rule.replace || "";
    try {
      if (rx) {
        const re = new RegExp(find, flags);
        // \1..\9 (Python backref syntax the user types) -> $1..$9 for JS.
        const jsRepl = repl.replace(/\$/g, "$$$$").replace(/\\(\d)/g, "$$$1");
        out = out.replace(re, jsRepl);
      } else {
        let pat = escapeRegex(find);
        if (ww) pat = "\\b" + pat + "\\b";
        const re = new RegExp(pat, flags);
        // Literal replacement: escape $ so $1 etc. are not interpreted.
        const litRepl = repl.replace(/\$/g, "$$$$");
        out = out.replace(re, litRepl);
      }
    } catch (_e) {
      warnings.push(`Rule ${idx + 1}: invalid regex`);
    }
  });

  if (td) out = tidy(out);
  return { output: out, warnings };
}

// ---- word-level diff for the before/after highlight -----------------------

function tokenize(s) {
  return s.match(/\s+|[^\s]+/g) || [];
}

// LCS-based token diff. Returns [{t:'eq'|'del'|'ins', s}].
export function diffTokens(aStr, bStr) {
  const a = tokenize(aStr);
  const b = tokenize(bStr);
  const n = a.length;
  const m = b.length;
  // Guard against pathological sizes (preview input is capped, but be safe).
  if (n * m > 4_000_000) {
    return [{ t: "del", s: aStr }, { t: "ins", s: bStr }];
  }
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: "eq", s: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ t: "del", s: a[i] });
      i++;
    } else {
      out.push({ t: "ins", s: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ t: "del", s: a[i++] });
  while (j < m) out.push({ t: "ins", s: b[j++] });
  return out;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
