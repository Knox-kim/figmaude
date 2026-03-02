import { initMessenger, onRequestFromUI, emitToUI } from "./messenger";
import {
  getAllMappings,
  linkComponent,
  unlinkComponent,
  updateFigmaHash,
  updateCodeHash,
  getGlobalConfig,
  setGlobalConfig,
} from "./mapping";

figma.showUI(__html__, { width: 400, height: 600 });
initMessenger();

// Selection change → notify UI
figma.on("selectionchange", () => {
  const node = figma.currentPage.selection[0];
  emitToUI({
    type: "SELECTION_CHANGED",
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
  });
});

// Request handlers
onRequestFromUI("GET_MAPPINGS", async () => {
  return await getAllMappings();
});

onRequestFromUI("LINK_COMPONENT", async ({ nodeId, codePath, componentName }) => {
  return { success: await linkComponent(nodeId, codePath, componentName) };
});

onRequestFromUI("UNLINK_COMPONENT", async ({ nodeId }) => {
  return { success: await unlinkComponent(nodeId) };
});

onRequestFromUI("UPDATE_FIGMA_HASH", async ({ nodeId }) => {
  const hash = await updateFigmaHash(nodeId);
  return { hash: hash ?? "" };
});

onRequestFromUI("GET_SELECTED_NODE", async () => {
  const node = figma.currentPage.selection[0];
  return {
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
  };
});

onRequestFromUI("GET_CONFIG", async () => {
  return { config: getGlobalConfig() };
});

onRequestFromUI("SET_CONFIG", async ({ config }) => {
  setGlobalConfig(config);
  return { success: true };
});

onRequestFromUI("UPDATE_CODE_HASH", async ({ nodeId, codeHash }) => {
  return { success: await updateCodeHash(nodeId, codeHash) };
});
