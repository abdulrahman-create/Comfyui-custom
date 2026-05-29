// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Nodes 2.0 compatibility helpers           ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Helpers for the ComfyUI "Nodes 2.0" (Vue/DOM) renderer migration.
// See the "ComfyUI Nodes 2.0 Migration" section in CLAUDE.md for the
// full background and the survive/break matrix.

/**
 * True when ComfyUI's Nodes 2.0 (Vue) renderer is active.
 * Driven by the `Comfy.VueNodes.Enabled` setting → `LiteGraph.vueNodesMode`.
 * Read live (do not cache) so a runtime renderer toggle is respected.
 */
export function isVueNodes() {
  return !!window.LiteGraph?.vueNodesMode;
}

/**
 * Adaptive `canvasOnly` house rule for internal DOM / custom widgets.
 *
 * The problem (Vue Compat #15 vs Nodes 2.0): setting `canvasOnly: true`
 * keeps an internal widget out of the legacy right-sidebar Parameters tab,
 * BUT in Nodes 2.0 `shouldRenderAsVue = !options.canvasOnly` excludes the
 * widget from the node body entirely → it renders nowhere (empty node).
 *
 * The fix: make `canvasOnly` a LIVE getter — `true` in the legacy renderer
 * (so it's filtered out of the Parameters tab, while the legacy node body
 * still draws DOM widgets regardless of the flag), and `false` in Nodes 2.0
 * (so the Vue body renders it). Evaluated fresh on every render, so a
 * runtime renderer toggle is honored without re-creating the widget.
 *
 * Call AFTER `addDOMWidget` / `addCustomWidget`, passing the returned widget.
 * Do NOT also pass `canvasOnly` in the widget's own options literal — let
 * this own the flag.
 *
 * @param {object} widget - the widget returned by addDOMWidget/addCustomWidget
 * @returns {object} the same widget (for chaining)
 */
export function applyAdaptiveCanvasOnly(widget) {
  if (!widget || !widget.options) return widget;
  try {
    Object.defineProperty(widget.options, "canvasOnly", {
      configurable: true,
      enumerable: true,
      get() {
        return !window.LiteGraph?.vueNodesMode;
      },
    });
  } catch (e) {
    // Fallback: some builds may store a non-configurable options object.
    // Static value (correct after a page reload, which switching the
    // renderer requires anyway).
    widget.options.canvasOnly = !window.LiteGraph?.vueNodesMode;
  }
  return widget;
}
