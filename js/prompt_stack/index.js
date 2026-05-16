import { app } from "/scripts/app.js";

const DEFAULT_W = 400;
const DEFAULT_H = 280;

app.registerExtension({
  name: "Pixaroma.PromptStack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "PixaromaPromptStack") return;

    const origNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      if (origNodeCreated) origNodeCreated.apply(this, arguments);
      queueMicrotask(() => {
        if (this.size[0] < DEFAULT_W) this.size[0] = DEFAULT_W;
        if (this.size[1] < DEFAULT_H) this.size[1] = DEFAULT_H;
        this.setDirtyCanvas(true, true);
      });
    };
  },
});
