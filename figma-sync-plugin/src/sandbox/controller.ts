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
import { extractComponentJSON } from "./componentExtractor";
import { applyComponentJSON } from "./componentBuilder";

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

// --- Write handlers for bidirectional sync ---

onRequestFromUI("GET_FILE_KEY", async () => {
  return { fileKey: figma.fileKey ?? "" };
});

onRequestFromUI("APPLY_VARIABLE_VALUES", async ({ values }) => {
  const variables = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let updated = 0;

  for (const update of values) {
    const variable = variables.find((v) => v.name === update.name);
    if (!variable) continue;

    const collection = collections.find((c) => c.id === variable.variableCollectionId);
    if (!collection) continue;

    for (const [modeKey, rawValue] of Object.entries(update.valuesByMode)) {
      // modeKey can be a modeId directly or "default" (use first mode)
      let modeId = modeKey;
      if (modeKey === "default" || !collection.modes.some((m) => m.modeId === modeKey)) {
        modeId = collection.modes[0]?.modeId;
      }
      if (!modeId) continue;

      try {
        const parsedValue = JSON.parse(rawValue);
        variable.setValueForMode(modeId, parsedValue);
      } catch {
        // Skip malformed values rather than failing the entire batch
        continue;
      }
    }
    updated++;
  }

  return { success: true, updated };
});

onRequestFromUI("APPLY_STYLE_VALUES", async ({ values }) => {
  const [paintStyles, textStyles, effectStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);

  let updated = 0;

  for (const update of values) {
    if (update.styleType === "PAINT") {
      const style = paintStyles.find((s) => s.name === update.name);
      if (style && update.paints) {
        style.paints = JSON.parse(update.paints);
        updated++;
      }
    } else if (update.styleType === "TEXT") {
      const style = textStyles.find((s) => s.name === update.name);
      if (style) {
        if (update.fontFamily || update.fontWeight) {
          await figma.loadFontAsync({
            family: update.fontFamily ?? style.fontName.family,
            style: update.fontWeight ?? style.fontName.style,
          });
          style.fontName = {
            family: update.fontFamily ?? style.fontName.family,
            style: update.fontWeight ?? style.fontName.style,
          };
        }
        if (update.fontSize != null) style.fontSize = update.fontSize;
        if (update.lineHeight) style.lineHeight = JSON.parse(update.lineHeight);
        if (update.letterSpacing) style.letterSpacing = JSON.parse(update.letterSpacing);
        updated++;
      }
    } else if (update.styleType === "EFFECT") {
      const style = effectStyles.find((s) => s.name === update.name);
      if (style && update.effects) {
        style.effects = JSON.parse(update.effects);
        updated++;
      }
    }
  }

  return { success: true, updated };
});

onRequestFromUI("EXTRACT_COMPONENT_JSON", async ({ nodeId }) => {
  const json = await extractComponentJSON(nodeId);
  return { json };
});

onRequestFromUI("APPLY_COMPONENT_JSON", async ({ nodeId, json }) => {
  const newNodeId = await applyComponentJSON(nodeId, json);
  return { success: true, nodeId: newNodeId };
});
