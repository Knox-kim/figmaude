import { initMessenger, onRequestFromUI, emitToUI } from "./messenger";
import {
  getAllMappings,
  linkComponent,
  unlinkComponent,
  updateFigmaHash,
  updateCodeHash,
  getGlobalConfig,
  setGlobalConfig,
  getNodeMapping,
} from "./mapping";
import {
  scanVariables,
  scanStyles,
  getVariablesMapping,
  getStylesMapping,
  linkVariables,
  linkStyles,
  unlinkVariables,
  unlinkStyles,
  updateVariablesHash,
  updateStylesHash,
  updateVariablesCodeHash,
  updateStylesCodeHash,
} from "./tokenMapping";
import { generateCSS } from "./cssGenerator";

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

onRequestFromUI("LINK_COMPONENT", async ({ nodeId, codePath }) => {
  return { success: await linkComponent(nodeId, codePath) };
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

onRequestFromUI("SCAN_COMPONENTS", async () => {
  const components: Array<{ nodeId: string; name: string }> = [];

  function walk(node: BaseNode) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      if (!getNodeMapping(node)) {
        components.push({ nodeId: node.id, name: node.name });
      }
    }
    if ("children" in node) {
      for (const child of (node as ChildrenMixin).children) {
        walk(child);
      }
    }
  }

  walk(figma.currentPage);
  return { components };
});

onRequestFromUI("SCAN_VARIABLES", async () => {
  const rawVars = await scanVariables();
  return {
    variables: rawVars.map((v) => ({
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      collectionName: v.collectionName,
    })),
  };
});

onRequestFromUI("SCAN_STYLES", async () => {
  const rawStyles = await scanStyles();
  return {
    styles: rawStyles.map((s) => ({
      id: s.id,
      name: s.name,
      styleType: s.styleType,
    })),
  };
});

onRequestFromUI("GET_VARIABLES_MAPPING", async () => {
  return await getVariablesMapping();
});

onRequestFromUI("GET_STYLES_MAPPING", async () => {
  return await getStylesMapping();
});

onRequestFromUI("LINK_VARIABLES", async ({ tokenFile }) => {
  return { success: await linkVariables(tokenFile) };
});

onRequestFromUI("LINK_STYLES", async ({ tokenFile }) => {
  return { success: await linkStyles(tokenFile) };
});

onRequestFromUI("UNLINK_VARIABLES", async () => {
  return { success: unlinkVariables() };
});

onRequestFromUI("UNLINK_STYLES", async () => {
  return { success: unlinkStyles() };
});

onRequestFromUI("UPDATE_VARIABLES_HASH", async () => {
  const hash = await updateVariablesHash();
  return { hash };
});

onRequestFromUI("UPDATE_STYLES_HASH", async () => {
  const hash = await updateStylesHash();
  return { hash };
});

onRequestFromUI("UPDATE_VARIABLES_CODE_HASH", async ({ codeHash }) => {
  return { success: updateVariablesCodeHash(codeHash) };
});

onRequestFromUI("UPDATE_STYLES_CODE_HASH", async ({ codeHash }) => {
  return { success: updateStylesCodeHash(codeHash) };
});

onRequestFromUI("GENERATE_CSS", async () => {
  const [variables, styles] = await Promise.all([scanVariables(), scanStyles()]);
  return { css: generateCSS(variables, styles) };
});
