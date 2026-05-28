// Pure-function graph helpers for Mute Switch Pixaroma.
// No browser globals - safe to import under both ComfyUI and Node.

// graphLinks may be a plain object keyed by id, OR a Map (Vue Compat #3).
function getLink(graphLinks, linkId) {
  if (!graphLinks || linkId == null) return null;
  if (typeof graphLinks.get === "function") return graphLinks.get(linkId);
  return graphLinks[linkId] || null;
}

// Walk every node upstream of startNode (following INPUT links).
// startNode is included in the returned set ONLY if `includeStart` is true.
// Cap depth defensively.
//
// nodesById: { [id]: node }   - node has .id, .inputs (array of {link})
// graphLinks: same shape as graph.links
//
// Returns a Set<nodeId>.
export function walkUpstream(startNode, nodesById, graphLinks, options = {}) {
  const { includeStart = true, maxDepth = 64 } = options;
  const out = new Set();
  if (!startNode) return out;

  if (includeStart) out.add(startNode.id);
  const queue = [{ node: startNode, depth: 0 }];

  while (queue.length) {
    const { node, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const inputs = node?.inputs || [];
    for (const slot of inputs) {
      const linkId = slot?.link;
      if (linkId == null) continue;
      const link = getLink(graphLinks, linkId);
      if (!link) continue;
      const upId = link.origin_id;
      if (upId == null) continue;
      if (out.has(upId)) continue; // already visited
      out.add(upId);
      const upNode = nodesById[upId];
      if (upNode) queue.push({ node: upNode, depth: depth + 1 });
    }
  }
  return out;
}

// Compute the set of nodes that should be muted, given:
//   onWires:  array of starting-node objects (each row's wired upstream node)
//             for rows that are ON
//   offWires: same shape, for rows that are OFF
// A node is in the result iff it is upstream of some OFF row but NOT upstream
// of any ON row (refcount-style "shared nodes spared").
//
// startNode for a row is the ORIGIN node of the row's input link (the upstream
// node the wire reaches first), NOT the Mute Switch itself. Skip
// disconnected rows at the call site.
//
// Excludes the Mute Switch node itself defensively.
export function resolveMuteSet(onWires, offWires, nodesById, graphLinks, muteSwitchId, options = {}) {
  const onSet = new Set();
  for (const start of onWires) {
    if (!start) continue;
    const set = walkUpstream(start, nodesById, graphLinks, options);
    for (const id of set) onSet.add(id);
  }

  const offSet = new Set();
  for (const start of offWires) {
    if (!start) continue;
    const set = walkUpstream(start, nodesById, graphLinks, options);
    for (const id of set) offSet.add(id);
  }

  // TO_MUTE = OFF_NODES \ ON_NODES
  const toMute = new Set();
  for (const id of offSet) {
    if (!onSet.has(id) && id !== muteSwitchId) {
      toMute.add(id);
    }
  }
  return toMute;
}
