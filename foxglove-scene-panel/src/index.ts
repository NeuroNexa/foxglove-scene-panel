import { ExtensionContext } from "@foxglove/extension";

import { initScenePanel } from "./ScenePanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "scene-panel",
    initPanel: initScenePanel,
  });
}
