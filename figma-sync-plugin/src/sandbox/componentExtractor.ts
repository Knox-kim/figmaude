import type {
  ComponentDescriptor,
  ComponentDescriptorFill,
  ComponentDescriptorStroke,
  ComponentDescriptorEffect,
  ComponentDescriptorLayout,
  ComponentDescriptorStyles,
  ComponentDescriptorTextStyles,
  ComponentDescriptorChild,
  ComponentDescriptorProperty,
  ComponentDescriptorVariantOverride,
} from "../shared/types";
import { parseDescription } from "../shared/descriptionParser";

// --- Helpers ---

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const hex = rgbToHex(r, g, b);
  if (a < 1) {
    const alphaHex = Math.round(a * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${alphaHex}`;
  }
  return hex;
}

async function resolveVariableName(binding: VariableAlias): Promise<string | undefined> {
  try {
    const variable = await figma.variables.getVariableByIdAsync(binding.id);
    return variable?.name ?? undefined;
  } catch {
    return undefined;
  }
}

// --- Fill / Stroke / Effect extractors ---

async function extractFills(
  node: SceneNode
): Promise<ComponentDescriptorFill[] | undefined> {
  if (!("fills" in node)) return undefined;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return undefined;

  const result: ComponentDescriptorFill[] = [];

  for (let i = 0; i < fills.length; i++) {
    const paint = fills[i];
    if (paint.type !== "SOLID") continue;
    if (paint.visible === false) continue;

    const fill: ComponentDescriptorFill = {
      type: "SOLID",
      color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    };
    if (paint.opacity !== undefined && paint.opacity < 1) {
      fill.opacity = paint.opacity;
    }

    // Check paint-level boundVariables (color → variable)
    if (paint.boundVariables?.color) {
      fill.boundVariable = await resolveVariableName(paint.boundVariables.color);
    }
    // Also check node-level boundVariables.fills array
    if (!fill.boundVariable && "boundVariables" in node) {
      const bv = (node as unknown as { boundVariables?: { fills?: VariableAlias[] } }).boundVariables;
      const fillBindings = bv?.fills;
      if (fillBindings && fillBindings[i]) {
        fill.boundVariable = await resolveVariableName(fillBindings[i]);
      }
    }

    result.push(fill);
  }

  return result.length > 0 ? result : undefined;
}

async function extractStrokes(
  node: SceneNode
): Promise<ComponentDescriptorStroke[] | undefined> {
  if (!("strokes" in node)) return undefined;
  const strokes = (node as MinimalStrokesMixin).strokes;
  if (!Array.isArray(strokes)) return undefined;

  const strokeWeight =
    "strokeWeight" in node
      ? (node as MinimalStrokesMixin).strokeWeight
      : undefined;
  const weight =
    strokeWeight !== undefined && strokeWeight !== figma.mixed
      ? strokeWeight
      : undefined;

  const result: ComponentDescriptorStroke[] = [];

  for (let i = 0; i < strokes.length; i++) {
    const paint = strokes[i];
    if (paint.type !== "SOLID") continue;
    if (paint.visible === false) continue;

    const stroke: ComponentDescriptorStroke = {
      type: "SOLID",
      color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
    };
    if (paint.opacity !== undefined && paint.opacity < 1) {
      stroke.opacity = paint.opacity;
    }
    if (weight !== undefined) {
      stroke.weight = weight;
    }
    if (paint.boundVariables?.color) {
      stroke.boundVariable = await resolveVariableName(paint.boundVariables.color);
    }

    result.push(stroke);
  }

  return result.length > 0 ? result : undefined;
}

function extractEffects(
  node: SceneNode
): ComponentDescriptorEffect[] | undefined {
  if (!("effects" in node)) return undefined;
  const effects = (node as BlendMixin).effects;
  if (!Array.isArray(effects) || effects.length === 0) return undefined;

  const result: ComponentDescriptorEffect[] = [];

  for (const effect of effects) {
    if (effect.visible === false) continue;

    const desc: ComponentDescriptorEffect = {
      type: effect.type as ComponentDescriptorEffect["type"],
      radius: effect.radius,
    };

    if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
      const shadow = effect as DropShadowEffect | InnerShadowEffect;
      desc.color = rgbaToHex(
        shadow.color.r,
        shadow.color.g,
        shadow.color.b,
        shadow.color.a
      );
      desc.offset = { x: shadow.offset.x, y: shadow.offset.y };
      if (shadow.spread !== undefined && shadow.spread !== 0) {
        desc.spread = shadow.spread;
      }
    }

    result.push(desc);
  }

  return result.length > 0 ? result : undefined;
}

// --- Layout ---

function extractLayout(
  node: SceneNode
): ComponentDescriptorLayout | undefined {
  if (!("layoutMode" in node)) return undefined;
  const frame = node as FrameNode;

  if (frame.layoutMode === "NONE") return undefined;

  const layout: ComponentDescriptorLayout = {
    mode: frame.layoutMode as "HORIZONTAL" | "VERTICAL",
  };

  const padding = {
    top: frame.paddingTop,
    right: frame.paddingRight,
    bottom: frame.paddingBottom,
    left: frame.paddingLeft,
  };
  if (padding.top || padding.right || padding.bottom || padding.left) {
    layout.padding = padding;
  }

  if (frame.itemSpacing) {
    layout.itemSpacing = frame.itemSpacing;
  }

  layout.primaryAxisAlign = frame.primaryAxisAlignItems;
  // BASELINE is a valid Figma value but not in our descriptor type — map to MIN
  const counterAlign = frame.counterAxisAlignItems;
  layout.counterAxisAlign = counterAlign === "BASELINE" ? "MIN" : counterAlign;
  layout.primaryAxisSizing = frame.primaryAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";
  layout.counterAxisSizing = frame.counterAxisSizingMode === "FIXED" ? "FIXED" : "AUTO";

  return layout;
}

// --- Styles (combines fills, strokes, effects, cornerRadius, size) ---

async function extractStyles(
  node: SceneNode
): Promise<ComponentDescriptorStyles | undefined> {
  const fills = await extractFills(node);
  const strokes = await extractStrokes(node);
  const effects = extractEffects(node);

  let cornerRadius: ComponentDescriptorStyles["cornerRadius"] | undefined;
  if ("cornerRadius" in node) {
    const cr = (node as RectangleNode).cornerRadius;
    if (cr === figma.mixed) {
      const rect = node as RectangleNode;
      cornerRadius = {
        topLeft: rect.topLeftRadius,
        topRight: rect.topRightRadius,
        bottomLeft: rect.bottomLeftRadius,
        bottomRight: rect.bottomRightRadius,
      };
    } else if (cr > 0) {
      cornerRadius = cr;
    }
  }

  const styles: ComponentDescriptorStyles = {};
  if (fills) styles.fills = fills;
  if (strokes) styles.strokes = strokes;
  if (effects) styles.effects = effects;
  if (cornerRadius !== undefined) styles.cornerRadius = cornerRadius;
  styles.width = Math.round(node.width);
  styles.height = Math.round(node.height);

  return Object.keys(styles).length > 0 ? styles : undefined;
}

// --- Text styles ---

function extractTextStyles(
  node: TextNode
): ComponentDescriptorTextStyles | undefined {
  const ts: ComponentDescriptorTextStyles = {};

  const fontSize = node.fontSize;
  if (fontSize !== figma.mixed) {
    ts.fontSize = fontSize;
  }

  const fontName = node.fontName;
  if (fontName !== figma.mixed) {
    ts.fontFamily = fontName.family;
    // Convert font style string to numeric weight approximation
    ts.fontWeight = fontStyleToWeight(fontName.style);
  }

  const lineHeight = node.lineHeight;
  if (lineHeight !== figma.mixed) {
    if (lineHeight.unit === "AUTO") {
      ts.lineHeight = { value: 0, unit: "AUTO" };
    } else if (lineHeight.unit === "PIXELS") {
      ts.lineHeight = { value: lineHeight.value, unit: "PIXELS" };
    } else if (lineHeight.unit === "PERCENT") {
      ts.lineHeight = { value: lineHeight.value, unit: "PERCENT" };
    }
  }

  const letterSpacing = node.letterSpacing;
  if (letterSpacing !== figma.mixed) {
    ts.letterSpacing = letterSpacing.value;
  }

  ts.textAlignHorizontal = node.textAlignHorizontal;

  // Text fills
  const fills = node.fills;
  if (fills !== figma.mixed && Array.isArray(fills)) {
    const textFills: ComponentDescriptorFill[] = [];
    for (const paint of fills) {
      if (paint.type === "SOLID" && paint.visible !== false) {
        textFills.push({
          type: "SOLID",
          color: rgbToHex(paint.color.r, paint.color.g, paint.color.b),
          ...(paint.opacity !== undefined && paint.opacity < 1
            ? { opacity: paint.opacity }
            : {}),
        });
      }
    }
    if (textFills.length > 0) {
      ts.fills = textFills;
    }
  }

  return Object.keys(ts).length > 0 ? ts : undefined;
}

function fontStyleToWeight(style: string): number {
  const map: Record<string, number> = {
    Thin: 100,
    "Extra Light": 200,
    ExtraLight: 200,
    Light: 300,
    Regular: 400,
    Medium: 500,
    "Semi Bold": 600,
    SemiBold: 600,
    Bold: 700,
    "Extra Bold": 800,
    ExtraBold: 800,
    Black: 900,
  };
  // Handle compound styles like "Bold Italic"
  for (const [key, weight] of Object.entries(map)) {
    if (style.includes(key)) return weight;
  }
  return 400;
}

// --- Children ---

async function extractChild(
  node: SceneNode
): Promise<ComponentDescriptorChild | null> {
  const supportedTypes = ["FRAME", "TEXT", "INSTANCE", "RECTANGLE", "ELLIPSE", "VECTOR"];
  if (!supportedTypes.includes(node.type)) return null;

  const child: ComponentDescriptorChild = {
    type: node.type as ComponentDescriptorChild["type"],
    name: node.name,
  };

  // Instance: resolve componentRef
  if (node.type === "INSTANCE") {
    const instance = node as InstanceNode;
    const mainComponent = await instance.getMainComponentAsync();
    if (mainComponent) {
      if (mainComponent.parent?.type === "COMPONENT_SET") {
        child.componentRef = mainComponent.parent.name;
      } else {
        child.componentRef = mainComponent.name;
      }
    }
  }

  // Layout (for frame-like nodes)
  if ("layoutMode" in node) {
    child.layout = extractLayout(node);
  }

  // Styles
  child.styles = await extractStyles(node);

  // Text-specific
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    child.textStyles = extractTextStyles(textNode);
    child.textContent = textNode.characters;

    // Check if text is bound to a component property (bindTo)
    if (textNode.componentPropertyReferences) {
      const charRef = textNode.componentPropertyReferences.characters;
      if (charRef) {
        child.bindTo = stripPropertyHash(charRef);
      }
    }
  }

  // Recurse into children for frame-like nodes
  if ("children" in node && node.type !== "INSTANCE") {
    const frame = node as FrameNode;
    const childNodes: ComponentDescriptorChild[] = [];
    for (const c of frame.children) {
      const extracted = await extractChild(c);
      if (extracted) childNodes.push(extracted);
    }
    if (childNodes.length > 0) {
      child.children = childNodes;
    }
  }

  return child;
}

// --- Properties ---

function extractProperties(
  node: ComponentNode | ComponentSetNode
): ComponentDescriptorProperty[] | undefined {
  let defs: ComponentPropertyDefinitions;
  try {
    defs = node.componentPropertyDefinitions;
  } catch {
    // ComponentSet with validation errors (e.g. conflicting variants) throws here
    return undefined;
  }
  if (!defs || Object.keys(defs).length === 0) return undefined;

  const result: ComponentDescriptorProperty[] = [];

  for (const [key, def] of Object.entries(defs)) {
    const name = stripPropertyHash(key);

    const prop: ComponentDescriptorProperty = {
      name,
      type: def.type as ComponentDescriptorProperty["type"],
      default: def.defaultValue,
    };

    if (def.type === "VARIANT" && def.variantOptions) {
      prop.options = def.variantOptions;
    }

    result.push(prop);
  }

  return result.length > 0 ? result : undefined;
}

function stripPropertyHash(key: string): string {
  const hashIdx = key.indexOf("#");
  return hashIdx >= 0 ? key.slice(0, hashIdx) : key;
}

// --- Variants ---

async function extractVariants(
  componentSet: ComponentSetNode
): Promise<ComponentDescriptorVariantOverride[] | undefined> {
  const children = componentSet.children as ComponentNode[];
  if (children.length < 2) return undefined;

  const baseVariant = componentSet.defaultVariant;
  const baseStyles = await extractStyles(baseVariant);
  const baseLayout = extractLayout(baseVariant);
  const baseChildren = await extractChildMap(baseVariant);

  const overrides: ComponentDescriptorVariantOverride[] = [];

  for (const variant of children) {
    if (variant.id === baseVariant.id) continue;

    const props = parseVariantName(variant.name);
    const variantStyles = await extractStyles(variant);
    const variantLayout = extractLayout(variant);
    const variantChildren = await extractChildMap(variant);

    const override: ComponentDescriptorVariantOverride = {
      props,
      overrides: {},
    };

    // Diff styles
    const styleDiff = diffStyles(baseStyles, variantStyles);
    if (styleDiff) override.overrides.styles = styleDiff;

    // Diff layout
    const layoutDiff = diffLayout(baseLayout, variantLayout);
    if (layoutDiff) override.overrides.layout = layoutDiff;

    // Diff children
    const childDiff = diffChildren(baseChildren, variantChildren);
    if (childDiff) {
      if (childDiff.modified) override.overrides.children = childDiff.modified;
      if (childDiff.removedNames) override.overrides.removedChildren = childDiff.removedNames;

      // Extract full child definitions for children added in this variant
      if (childDiff.addedNames) {
        const added: ComponentDescriptorChild[] = [];
        if ("children" in variant) {
          for (const child of (variant as FrameNode).children) {
            if (childDiff.addedNames.includes(child.name)) {
              const extracted = await extractChild(child);
              if (extracted) added.push(extracted);
            }
          }
        }
        if (added.length > 0) override.overrides.addedChildren = added;
      }
    }

    // Always include — even if no visual overrides, the variant's props
    // (e.g., Size=lg) define a distinct variant that must exist.
    overrides.push(override);
  }

  return overrides.length > 0 ? overrides : undefined;
}

function parseVariantName(name: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = name.split(",").map((s) => s.trim());
  for (const pair of pairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx >= 0) {
      const key = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

interface ChildSnapshot {
  styles?: ComponentDescriptorStyles;
  textStyles?: ComponentDescriptorTextStyles;
  textContent?: string;
}

async function extractChildMap(
  node: SceneNode
): Promise<Map<string, ChildSnapshot>> {
  const map = new Map<string, ChildSnapshot>();
  if (!("children" in node)) return map;
  const frame = node as FrameNode;
  for (const child of frame.children) {
    const snapshot: ChildSnapshot = {
      styles: await extractStyles(child),
    };
    if (child.type === "TEXT") {
      const textNode = child as TextNode;
      snapshot.textStyles = extractTextStyles(textNode);
      snapshot.textContent = textNode.characters;
    }
    map.set(child.name, snapshot);
  }
  return map;
}

function diffStyles(
  base: ComponentDescriptorStyles | undefined,
  variant: ComponentDescriptorStyles | undefined
): Partial<ComponentDescriptorStyles> | undefined {
  if (!variant) return undefined;
  if (!base) return variant;

  const diff: Partial<ComponentDescriptorStyles> = {};
  let hasDiff = false;

  if (JSON.stringify(variant.fills) !== JSON.stringify(base.fills)) {
    diff.fills = variant.fills;
    hasDiff = true;
  }
  if (JSON.stringify(variant.strokes) !== JSON.stringify(base.strokes)) {
    diff.strokes = variant.strokes;
    hasDiff = true;
  }
  if (JSON.stringify(variant.effects) !== JSON.stringify(base.effects)) {
    diff.effects = variant.effects;
    hasDiff = true;
  }
  if (JSON.stringify(variant.cornerRadius) !== JSON.stringify(base.cornerRadius)) {
    diff.cornerRadius = variant.cornerRadius;
    hasDiff = true;
  }
  if (variant.width !== base.width) {
    diff.width = variant.width;
    hasDiff = true;
  }
  if (variant.height !== base.height) {
    diff.height = variant.height;
    hasDiff = true;
  }

  return hasDiff ? diff : undefined;
}

function diffLayout(
  base: ComponentDescriptorLayout | undefined,
  variant: ComponentDescriptorLayout | undefined
): Partial<ComponentDescriptorLayout> | undefined {
  if (!variant) return undefined;
  if (!base) return variant;

  if (JSON.stringify(base) === JSON.stringify(variant)) return undefined;

  const diff: Partial<ComponentDescriptorLayout> = {};
  let hasDiff = false;

  if (variant.mode !== base.mode) {
    diff.mode = variant.mode;
    hasDiff = true;
  }
  if (JSON.stringify(variant.padding) !== JSON.stringify(base.padding)) {
    diff.padding = variant.padding;
    hasDiff = true;
  }
  if (variant.itemSpacing !== base.itemSpacing) {
    diff.itemSpacing = variant.itemSpacing;
    hasDiff = true;
  }
  if (variant.primaryAxisAlign !== base.primaryAxisAlign) {
    diff.primaryAxisAlign = variant.primaryAxisAlign;
    hasDiff = true;
  }
  if (variant.counterAxisAlign !== base.counterAxisAlign) {
    diff.counterAxisAlign = variant.counterAxisAlign;
    hasDiff = true;
  }

  return hasDiff ? diff : undefined;
}

interface ChildDiffResult {
  modified?: Record<string, {
    styles?: Partial<ComponentDescriptorStyles>;
    textStyles?: Partial<ComponentDescriptorTextStyles>;
    textContent?: string;
  }>;
  addedNames?: string[];
  removedNames?: string[];
}

function diffChildren(
  base: Map<string, ChildSnapshot>,
  variant: Map<string, ChildSnapshot>
): ChildDiffResult | undefined {
  const modified: Record<string, {
    styles?: Partial<ComponentDescriptorStyles>;
    textStyles?: Partial<ComponentDescriptorTextStyles>;
    textContent?: string;
  }> = {};
  let hasDiff = false;

  const addedNames: string[] = [];
  const removedNames: string[] = [];

  for (const [name, variantChild] of variant.entries()) {
    const baseChild = base.get(name);
    if (!baseChild) {
      // Child exists in variant but not in base
      addedNames.push(name);
      hasDiff = true;
      continue;
    }

    const childOverride: {
      styles?: Partial<ComponentDescriptorStyles>;
      textStyles?: Partial<ComponentDescriptorTextStyles>;
      textContent?: string;
    } = {};
    let childHasDiff = false;

    const styleDiff = diffStyles(baseChild.styles, variantChild.styles);
    if (styleDiff) {
      childOverride.styles = styleDiff;
      childHasDiff = true;
    }

    if (
      JSON.stringify(variantChild.textStyles) !==
      JSON.stringify(baseChild.textStyles)
    ) {
      childOverride.textStyles = variantChild.textStyles;
      childHasDiff = true;
    }

    if (variantChild.textContent !== baseChild.textContent) {
      childOverride.textContent = variantChild.textContent;
      childHasDiff = true;
    }

    if (childHasDiff) {
      modified[name] = childOverride;
      hasDiff = true;
    }
  }

  // Children in base but not in variant
  for (const name of base.keys()) {
    if (!variant.has(name)) {
      removedNames.push(name);
      hasDiff = true;
    }
  }

  if (!hasDiff) return undefined;

  return {
    modified: Object.keys(modified).length > 0 ? modified : undefined,
    addedNames: addedNames.length > 0 ? addedNames : undefined,
    removedNames: removedNames.length > 0 ? removedNames : undefined,
  };
}

// --- Main export ---

export async function extractComponentJSON(
  nodeId: string
): Promise<ComponentDescriptor> {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(
      `Node ${nodeId} is type "${node.type}", expected COMPONENT or COMPONENT_SET`
    );
  }

  const descriptor: ComponentDescriptor = {
    $schema: "figma-sync/component-descriptor@1",
    name: node.name,
  };

  if (node.description) {
    const parsed = parseDescription(node.description);
    if (parsed.plainDescription) {
      descriptor.description = parsed.plainDescription;
    }
    if (Object.keys(parsed.annotations).length > 0) {
      descriptor.annotations = parsed.annotations;
    }
  }

  // Properties
  descriptor.properties = extractProperties(node);

  if (node.type === "COMPONENT_SET") {
    // For component sets, extract from the default variant (base)
    const baseVariant = node.defaultVariant;
    descriptor.layout = extractLayout(baseVariant);
    descriptor.styles = await extractStyles(baseVariant);

    // Extract children from base variant
    const children: ComponentDescriptorChild[] = [];
    if ("children" in baseVariant) {
      for (const child of baseVariant.children) {
        const extracted = await extractChild(child);
        if (extracted) children.push(extracted);
      }
    }
    if (children.length > 0) {
      descriptor.children = children;
    }

    // Extract variant overrides
    descriptor.variants = await extractVariants(node);
  } else {
    // Single component
    descriptor.layout = extractLayout(node);
    descriptor.styles = await extractStyles(node);

    // Extract children
    const children: ComponentDescriptorChild[] = [];
    for (const child of node.children) {
      const extracted = await extractChild(child);
      if (extracted) children.push(extracted);
    }
    if (children.length > 0) {
      descriptor.children = children;
    }
  }

  return descriptor;
}
