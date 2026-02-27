import { initMessenger, onRequestFromUI, emitToUI } from "./messenger";
import {
  getAllMappings,
  linkComponent,
  unlinkComponent,
  updateFigmaHash,
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
  return { mappings: getAllMappings() };
});

onRequestFromUI("LINK_COMPONENT", async ({ nodeId, codePath, componentName }) => {
  return { success: linkComponent(nodeId, codePath, componentName) };
});

onRequestFromUI("UNLINK_COMPONENT", async ({ nodeId }) => {
  return { success: unlinkComponent(nodeId) };
});

onRequestFromUI("UPDATE_FIGMA_HASH", async ({ nodeId }) => {
  const hash = updateFigmaHash(nodeId);
  return { hash: hash ?? "" };
});

onRequestFromUI("GET_SELECTED_NODE", async () => {
  const node = figma.currentPage.selection[0];
  return {
    nodeId: node?.id ?? null,
    nodeName: node?.name ?? null,
  };
});
