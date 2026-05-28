// Run with: node scripts/mute_switch_test.mjs
// Tests the pure-function pieces of Mute Switch (walkUpstream + resolveMuteSet)
// against synthetic graph fixtures. No browser, no ComfyUI dependency.

import assert from "node:assert/strict";
import { walkUpstream, resolveMuteSet } from "../js/mute_switch/upstream.mjs";

function makeNode(id, inputLinks = []) {
  return {
    id,
    inputs: inputLinks.map((linkId) => ({ link: linkId })),
  };
}
function makeLink(id, originId) {
  return { id, origin_id: originId };
}

// ── Test 1: linear chain A -> B -> C -> D
{
  const A = makeNode("A", []);
  const B = makeNode("B", [1]);
  const C = makeNode("C", [2]);
  const D = makeNode("D", [3]);
  const links = {
    1: makeLink(1, "A"),
    2: makeLink(2, "B"),
    3: makeLink(3, "C"),
  };
  const nodesById = { A, B, C, D };

  const r = walkUpstream(D, nodesById, links);
  assert.deepEqual([...r].sort(), ["A", "B", "C", "D"], "Test 1: linear chain");
  console.log("PASS Test 1: linear chain A->B->C->D walked from D");
}

// ── Test 2: shared upstream - X feeds B and C
{
  const X = makeNode("X", []);
  const B = makeNode("B", [1]);
  const C = makeNode("C", [2]);
  const D = makeNode("D", [3, 4]);
  const links = {
    1: makeLink(1, "X"),
    2: makeLink(2, "X"),
    3: makeLink(3, "B"),
    4: makeLink(4, "C"),
  };
  const nodesById = { X, B, C, D };

  const r = walkUpstream(D, nodesById, links);
  assert.deepEqual([...r].sort(), ["B", "C", "D", "X"], "Test 2: shared X reached once");
  console.log("PASS Test 2: shared upstream X reached via both B and C, deduped");
}

// ── Test 3: resolveMuteSet - two isolated scenes, one OFF
{
  const A1 = makeNode("A1", []);
  const KS1 = makeNode("KS1", [1]);
  const A2 = makeNode("A2", []);
  const KS2 = makeNode("KS2", [2]);
  const links = {
    1: makeLink(1, "A1"),
    2: makeLink(2, "A2"),
  };
  const nodesById = { A1, KS1, A2, KS2 };
  const mute = resolveMuteSet([KS1], [KS2], nodesById, links, "MUTE_SW");
  assert.deepEqual([...mute].sort(), ["A2", "KS2"], "Test 3: only OFF scene muted");
  console.log("PASS Test 3: isolated scenes, OFF scene fully muted");
}

// ── Test 4: resolveMuteSet - shared upstream is SPARED
{
  const SHARED = makeNode("SHARED", []);
  const KS1 = makeNode("KS1", [1]);
  const KS2 = makeNode("KS2", [2]);
  const links = {
    1: makeLink(1, "SHARED"),
    2: makeLink(2, "SHARED"),
  };
  const nodesById = { SHARED, KS1, KS2 };
  const mute = resolveMuteSet([KS1], [KS2], nodesById, links, "MUTE_SW");
  assert.deepEqual([...mute], ["KS2"], "Test 4: shared upstream spared");
  console.log("PASS Test 4: shared upstream is spared when any dependent scene is ON");
}

// ── Test 5: resolveMuteSet - both scenes OFF mutes everything
{
  const SHARED = makeNode("SHARED", []);
  const KS1 = makeNode("KS1", [1]);
  const KS2 = makeNode("KS2", [2]);
  const links = {
    1: makeLink(1, "SHARED"),
    2: makeLink(2, "SHARED"),
  };
  const nodesById = { SHARED, KS1, KS2 };
  const mute = resolveMuteSet([], [KS1, KS2], nodesById, links, "MUTE_SW");
  assert.deepEqual([...mute].sort(), ["KS1", "KS2", "SHARED"], "Test 5: both off mutes shared too");
  console.log("PASS Test 5: both scenes OFF mutes shared upstream too");
}

// ── Test 6: graph.links as a Map
{
  const A = makeNode("A", []);
  const B = makeNode("B", [1]);
  const linksMap = new Map();
  linksMap.set(1, makeLink(1, "A"));
  const nodesById = { A, B };
  const r = walkUpstream(B, nodesById, linksMap);
  assert.deepEqual([...r].sort(), ["A", "B"], "Test 6: links as Map works");
  console.log("PASS Test 6: graph.links as Map (Vue Compat #3)");
}

// ── Test 7: cycle does not infinite-loop
{
  const A = makeNode("A", [2]);
  const B = makeNode("B", [1]);
  const links = {
    1: makeLink(1, "A"),
    2: makeLink(2, "B"),
  };
  const nodesById = { A, B };
  const r = walkUpstream(A, nodesById, links);
  assert.deepEqual([...r].sort(), ["A", "B"], "Test 7: cycle terminates");
  console.log("PASS Test 7: cycle terminates via visited-set");
}

// ── Test 8: maxDepth cap
{
  const nodes = {};
  const links = {};
  for (let i = 0; i < 10; i++) {
    const id = `N${i}`;
    const inputs = i === 0 ? [] : [i];
    nodes[id] = makeNode(id, inputs);
    if (i > 0) links[i] = makeLink(i, `N${i - 1}`);
  }
  const r3 = walkUpstream(nodes.N9, nodes, links, { maxDepth: 3 });
  // Depth 0: N9 visits N8. Depth 1: N8 visits N7. Depth 2: N7 visits N6.
  // Depth 3 would visit N5 but we stop. So we should have N9..N6.
  assert.deepEqual([...r3].sort(), ["N6", "N7", "N8", "N9"], "Test 8: depth cap");
  console.log("PASS Test 8: maxDepth honored");
}

console.log("\nAll mute_switch tests passed.");
