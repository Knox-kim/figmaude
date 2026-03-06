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
import { updateSyncNotes } from "../shared/descriptionParser";
import { isOnPage } from "./mapping";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  if (!hex || typeof hex !== "string") return { r: 0, g: 0, b: 0, a: 1 };

  let h = hex.replace(/^#/, "");

  // Expand 3-char shorthand (e.g. "f0a" → "ff00aa")
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  // 4-char shorthand with alpha (e.g. "f0a8" → "ff00aa88")
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }

  // Validate hex string contains only hex characters
  if (!/^[0-9a-fA-F]{6,8}$/.test(h)) return { r: 0, g: 0, b: 0, a: 1 };

  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;

  return { r, g, b, a };
}

function fontWeightToStyle(weight: number): string {
  const map: Record<number, string> = {
    100: "Thin",
    200: "ExtraLight",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
    900: "Black",
  };
  return map[weight] ?? "Regular";
}

const DEFAULT_FONT: FontName = { family: "Inter", style: "Regular" };

// ---------------------------------------------------------------------------
// Lookup caches — populated once per applyComponentJSON call, cleared after.
// Avoids repeated figma.variables.getLocalVariablesAsync and figma.root.findAll
// calls which are expensive when invoked per-fill or per-instance.
// ---------------------------------------------------------------------------

let _varCache: Map<string, Variable> | null = null;
let _compCache: Map<string, SceneNode> | null = null;
let _textStyleCache: Map<string, TextStyle> | null = null;
let _paintStyleCache: Map<string, PaintStyle> | null = null;
let _effectStyleCache: Map<string, EffectStyle> | null = null;

async function initCaches(): Promise<void> {
  const [colorVars, floatVars, textStyles, paintStyles, effectStyles] = await Promise.all([
    figma.variables.getLocalVariablesAsync("COLOR"),
    figma.variables.getLocalVariablesAsync("FLOAT"),
    figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);
  _varCache = new Map([
    ...colorVars.map((v) => [v.name, v] as const),
    ...floatVars.map((v) => [v.name, v] as const),
  ]);
  _textStyleCache = new Map(textStyles.map((s) => [s.name, s] as const));
  _paintStyleCache = new Map(paintStyles.map((s) => [s.name, s] as const));
  _effectStyleCache = new Map(effectStyles.map((s) => [s.name, s] as const));

  await figma.loadAllPagesAsync();
  const allComponents = figma.root.findAll(
    (n) => n.type === "COMPONENT" || n.type === "COMPONENT_SET",
  ) as SceneNode[];
  _compCache = new Map(allComponents.map((n) => [n.name, n]));
}

function clearCaches(): void {
  _varCache = null;
  _compCache = null;
  _textStyleCache = null;
  _paintStyleCache = null;
  _effectStyleCache = null;
}

// ---------------------------------------------------------------------------
// Apply fills / strokes / effects / cornerRadius / layout / styles
// ---------------------------------------------------------------------------

function findVariableByName(name: string): Variable | null {
  return _varCache?.get(name) ?? null;
}

function applyFills(
  node: GeometryMixin | MinimalFillsMixin,
  fills: ComponentDescriptorFill[],
): void {
  const paints: SolidPaint[] = [];

  for (const fill of fills) {
    const { r, g, b, a } = hexToRgb(fill.color);
    let paint: SolidPaint = {
      type: "SOLID",
      color: { r, g, b },
      opacity: fill.opacity ?? a,
    };

    if (fill.boundVariable) {
      const variable = findVariableByName(fill.boundVariable);
      if (variable) {
        paint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
      }
    }

    paints.push(paint);
  }

  node.fills = paints;
}

function applyStrokes(
  node: GeometryMixin | MinimalStrokesMixin,
  strokes: ComponentDescriptorStroke[],
): void {
  const paints: SolidPaint[] = [];
  let weight: number | undefined;

  for (const stroke of strokes) {
    const { r, g, b, a } = hexToRgb(stroke.color);
    let paint: SolidPaint = {
      type: "SOLID",
      color: { r, g, b },
      opacity: stroke.opacity ?? a,
    };

    if (stroke.boundVariable) {
      const variable = findVariableByName(stroke.boundVariable);
      if (variable) {
        paint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
      }
    }

    paints.push(paint);
    if (stroke.weight !== undefined) {
      weight = stroke.weight;
    }
  }

  node.strokes = paints;
  if (weight !== undefined && "strokeWeight" in node) {
    (node as MinimalStrokesMixin).strokeWeight = weight;
  }

  // Apply stroke alignment from first stroke that has it
  const strokeAlign = strokes.find((s) => s.align)?.align;
  if (strokeAlign && "strokeAlign" in node) {
    (node as GeometryMixin).strokeAlign = strokeAlign;
  }
}

function applyEffects(node: BlendMixin, effects: ComponentDescriptorEffect[]): void {
  const result: Effect[] = [];

  for (const eff of effects) {
    if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
      const { r, g, b, a } = eff.color ? hexToRgb(eff.color) : { r: 0, g: 0, b: 0, a: 0.25 };
      const shadow: DropShadowEffect | InnerShadowEffect = {
        type: eff.type,
        color: { r, g, b, a },
        offset: eff.offset ?? { x: 0, y: 4 },
        radius: eff.radius,
        spread: eff.spread ?? 0,
        visible: eff.visible !== false,
        blendMode: "NORMAL",
      };
      result.push(shadow);
    } else {
      // LAYER_BLUR or BACKGROUND_BLUR
      const blur: BlurEffectNormal = {
        type: eff.type as "LAYER_BLUR" | "BACKGROUND_BLUR",
        blurType: "NORMAL",
        radius: eff.radius,
        visible: eff.visible !== false,
      };
      result.push(blur);
    }
  }

  node.effects = result;
}

function applyCornerRadius(
  node: SceneNode,
  cr: number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number },
  boundVariables?: ComponentDescriptorStyles["boundVariables"],
): void {
  if (!("cornerRadius" in node)) return;
  const rect = node as RectangleNode | FrameNode | ComponentNode;

  if (typeof cr === "number") {
    rect.cornerRadius = cr;
  } else {
    rect.topLeftRadius = cr.topLeft;
    rect.topRightRadius = cr.topRight;
    rect.bottomLeftRadius = cr.bottomLeft;
    rect.bottomRightRadius = cr.bottomRight;
  }

  // Apply corner radius variable bindings
  if (boundVariables) {
    const fields = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"] as const;
    for (const field of fields) {
      const varName = boundVariables[field];
      if (varName) {
        const v = findVariableByName(varName);
        if (v) rect.setBoundVariable(field, v);
      }
    }
  }
}

function applyLayout(node: FrameNode | ComponentNode, layout: ComponentDescriptorLayout): void {
  node.layoutMode = layout.mode;

  if (layout.mode === "NONE") return;

  if (layout.padding) {
    node.paddingTop = layout.padding.top;
    node.paddingRight = layout.padding.right;
    node.paddingBottom = layout.padding.bottom;
    node.paddingLeft = layout.padding.left;
  }

  if (layout.itemSpacing !== undefined) {
    node.itemSpacing = layout.itemSpacing;
  }

  if (layout.primaryAxisAlign) {
    node.primaryAxisAlignItems = layout.primaryAxisAlign;
  }

  if (layout.counterAxisAlign) {
    node.counterAxisAlignItems = layout.counterAxisAlign;
  }

  if (layout.primaryAxisSizing) {
    node.primaryAxisSizingMode = layout.primaryAxisSizing;
  }

  if (layout.counterAxisSizing) {
    node.counterAxisSizingMode = layout.counterAxisSizing;
  }

  // Apply layout variable bindings
  if (layout.boundVariables) {
    const fields = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "itemSpacing", "counterAxisSpacing"] as const;
    for (const field of fields) {
      const varName = layout.boundVariables[field];
      if (varName) {
        const v = findVariableByName(varName);
        if (v) node.setBoundVariable(field, v);
      }
    }
  }
}

function applyLayoutSizing(node: SceneNode, styles: ComponentDescriptorStyles): void {
  if (styles.layoutSizingHorizontal && "layoutSizingHorizontal" in node) {
    (node as FrameNode).layoutSizingHorizontal = styles.layoutSizingHorizontal;
  }
  if (styles.layoutSizingVertical && "layoutSizingVertical" in node) {
    (node as FrameNode).layoutSizingVertical = styles.layoutSizingVertical;
  }
}

async function applyStyles(node: SceneNode, styles: ComponentDescriptorStyles): Promise<void> {
  if (styles.width !== undefined && styles.height !== undefined) {
    (node as FrameNode).resize(styles.width, styles.height);
  } else if (styles.width !== undefined) {
    (node as FrameNode).resize(styles.width, (node as FrameNode).height);
  } else if (styles.height !== undefined) {
    (node as FrameNode).resize((node as FrameNode).width, styles.height);
  }

  // Fills: try PaintStyle ref first, fall back to raw fills
  let fillStyleBound = false;
  if (styles.fillStyleRef && _paintStyleCache && "fillStyleId" in node) {
    const paintStyle = _paintStyleCache.get(styles.fillStyleRef);
    if (paintStyle) {
      await (node as GeometryMixin & SceneNode).setFillStyleIdAsync(paintStyle.id);
      fillStyleBound = true;
    }
  }
  if (!fillStyleBound) {
    if (styles.fills && "fills" in node) {
      applyFills(node as GeometryMixin, styles.fills);
    } else if ("fills" in node) {
      (node as GeometryMixin).fills = [];
    }
  }

  // Strokes: try PaintStyle ref first, fall back to raw strokes
  let strokeStyleBound = false;
  if (styles.strokeStyleRef && _paintStyleCache && "strokeStyleId" in node) {
    const paintStyle = _paintStyleCache.get(styles.strokeStyleRef);
    if (paintStyle) {
      await (node as GeometryMixin & SceneNode).setStrokeStyleIdAsync(paintStyle.id);
      strokeStyleBound = true;
      // Still need to apply weight and alignment (style doesn't cover these)
      if (styles.strokes?.length) {
        const weight = styles.strokes.find((s) => s.weight !== undefined)?.weight;
        if (weight !== undefined && "strokeWeight" in node) {
          (node as MinimalStrokesMixin).strokeWeight = weight;
        }
        const align = styles.strokes.find((s) => s.align)?.align;
        if (align && "strokeAlign" in node) {
          (node as GeometryMixin).strokeAlign = align;
        }
      }
    }
  }
  if (!strokeStyleBound) {
    if (styles.strokes && "strokes" in node) {
      applyStrokes(node as GeometryMixin, styles.strokes);
    } else if ("strokes" in node) {
      (node as MinimalStrokesMixin).strokes = [];
    }
  }

  // Effects: try EffectStyle ref first, fall back to raw effects
  let effectStyleBound = false;
  if (styles.effectStyleRef && _effectStyleCache && "effectStyleId" in node) {
    const effectStyle = _effectStyleCache.get(styles.effectStyleRef);
    if (effectStyle) {
      await (node as BlendMixin & SceneNode).setEffectStyleIdAsync(effectStyle.id);
      effectStyleBound = true;
    }
  }
  if (!effectStyleBound) {
    if (styles.effects && "effects" in node) {
      applyEffects(node as BlendMixin, styles.effects);
    } else if ("effects" in node) {
      (node as BlendMixin).effects = [];
    }
  }

  if (styles.cornerRadius !== undefined) {
    applyCornerRadius(node, styles.cornerRadius, styles.boundVariables);
  }

  if (styles.opacity !== undefined && "opacity" in node) {
    (node as BlendMixin).opacity = styles.opacity;
  }

  // Apply style variable bindings (width, height, opacity)
  if (styles.boundVariables) {
    const bv = styles.boundVariables;
    const frameNode = node as FrameNode;
    if (bv.width) {
      const v = findVariableByName(bv.width);
      if (v) frameNode.setBoundVariable("width", v);
    }
    if (bv.height) {
      const v = findVariableByName(bv.height);
      if (v) frameNode.setBoundVariable("height", v);
    }
    if (bv.opacity && "opacity" in node) {
      const v = findVariableByName(bv.opacity);
      if (v) (node as BlendMixin & SceneNode).setBoundVariable("opacity", v);
    }
  }

  // layoutSizing is applied separately after parent.appendChild
}

async function applyTextStyles(node: TextNode, ts: ComponentDescriptorTextStyles): Promise<void> {
  // Try to bind a TextStyle by name first — this sets font, size, lineHeight,
  // letterSpacing all at once and shows as a named style in Figma's UI.
  if (ts.textStyleRef && _textStyleCache) {
    const textStyle = _textStyleCache.get(ts.textStyleRef);
    if (textStyle) {
      // Must load the font the style uses before binding
      await figma.loadFontAsync(textStyle.fontName);
      await node.setTextStyleIdAsync(textStyle.id);

      // TextStyle doesn't cover alignment or autoResize — apply those separately
      if (ts.textAlignHorizontal) {
        node.textAlignHorizontal = ts.textAlignHorizontal;
      }
      if (ts.textAutoResize) {
        node.textAutoResize = ts.textAutoResize;
      }
      // TextStyle doesn't cover fills either — apply if present
      if (ts.fills) {
        applyFills(node, ts.fills);
      }
      return;
    }
    // Style not found — fall through to hardcoded properties
  }

  const family = ts.fontFamily ?? DEFAULT_FONT.family;
  const style = ts.fontWeight ? fontWeightToStyle(ts.fontWeight) : DEFAULT_FONT.style;

  await figma.loadFontAsync({ family, style });
  node.fontName = { family, style };

  if (ts.fontSize !== undefined) {
    node.fontSize = ts.fontSize;
  }

  if (ts.lineHeight !== undefined) {
    if (typeof ts.lineHeight === "number") {
      node.lineHeight = { value: ts.lineHeight, unit: "PIXELS" };
    } else if (ts.lineHeight.unit === "AUTO") {
      node.lineHeight = { unit: "AUTO" };
    } else {
      node.lineHeight = { value: ts.lineHeight.value, unit: ts.lineHeight.unit };
    }
  }

  if (ts.letterSpacing !== undefined) {
    if (typeof ts.letterSpacing === "number") {
      node.letterSpacing = { value: ts.letterSpacing, unit: "PIXELS" };
    } else {
      node.letterSpacing = { value: ts.letterSpacing.value, unit: ts.letterSpacing.unit };
    }
  }

  if (ts.textAlignHorizontal) {
    node.textAlignHorizontal = ts.textAlignHorizontal;
  }

  if (ts.textAutoResize) {
    node.textAutoResize = ts.textAutoResize;
  }

  if (ts.fills) {
    applyFills(node, ts.fills);
  }
}

// ---------------------------------------------------------------------------
// Build children
// ---------------------------------------------------------------------------

async function buildChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
  notes?: string[],
): Promise<SceneNode> {
  let node: SceneNode;

  switch (child.type) {
    case "TEXT":
      return await buildTextChild(child, parent);
    case "INSTANCE":
      return await buildInstanceChild(child, parent, notes);
    case "FRAME":
      return await buildFrameChild(child, parent, notes);
    case "RECTANGLE":
      node = buildRectangleChild(child, parent);
      break;
    case "ELLIPSE":
      node = buildEllipseChild(child, parent);
      break;
    case "POLYGON":
      node = buildPolygonChild(child, parent);
      break;
    case "STAR":
      node = buildStarChild(child, parent);
      break;
    case "LINE":
      node = buildLineChild(child, parent);
      break;
    case "VECTOR":
      if (child.vectorPaths) {
        node = buildVectorChild(child, parent);
      } else {
        node = buildRectangleChild(child, parent);
        if (notes) {
          notes.push(`VECTOR "${child.name}" has no vectorPaths, created as placeholder RECTANGLE`);
        }
      }
      break;
  }

  // Apply styles for shape nodes (RECTANGLE, ELLIPSE, VECTOR, POLYGON, STAR, LINE).
  // Always call applyStyles even if styles is absent — clears Figma defaults (e.g. vector stroke).
  await applyStyles(node, child.styles ?? {});
  if (child.styles) {
    applyLayoutSizing(node, child.styles);
  }

  // Apply rotation
  if (child.rotation !== undefined && child.rotation !== 0) {
    (node as SceneNode & { rotation: number }).rotation = child.rotation;
  }

  // Apply BOOLEAN visibility binding
  if (child.visibleBindTo) {
    (node as SceneNode & { componentPropertyReferences?: Record<string, string> }).componentPropertyReferences = { visible: child.visibleBindTo };
  }

  return node;
}

async function buildTextChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): Promise<TextNode> {
  const text = figma.createText();
  text.name = child.name;
  parent.appendChild(text);

  if (child.styles) applyLayoutSizing(text, child.styles);

  // Load font before setting characters
  const family = child.textStyles?.fontFamily ?? DEFAULT_FONT.family;
  const style = child.textStyles?.fontWeight
    ? fontWeightToStyle(child.textStyles.fontWeight)
    : DEFAULT_FONT.style;
  await figma.loadFontAsync({ family, style });
  text.fontName = { family, style };

  if (child.textContent) {
    text.characters = child.textContent;
  }

  // Apply styles first (clears defaults), then textStyles (fills win for text color)
  await applyStyles(text, child.styles ?? {});

  if (child.textStyles) {
    await applyTextStyles(text, child.textStyles);
  }

  if (child.bindTo) {
    text.componentPropertyReferences = {
      ...text.componentPropertyReferences,
      characters: child.bindTo,
    };
  }

  if (child.visibleBindTo) {
    text.componentPropertyReferences = {
      ...text.componentPropertyReferences,
      visible: child.visibleBindTo,
    };
  }

  return text;
}

async function buildInstanceChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
  notes?: string[],
): Promise<SceneNode> {
  // Resolve target: componentRef → componentName (alias) → child.name
  const ref = child.componentRef || child.componentName || child.name;
  const target = ref ? _compCache?.get(ref) : null;

  if (target && !target.removed) {
    let comp: ComponentNode;
    if (target.type === "COMPONENT_SET") {
      comp = (target as ComponentSetNode).defaultVariant;
    } else {
      comp = target as ComponentNode;
    }
    const instance = comp.createInstance();
    instance.name = child.name;
    parent.appendChild(instance);

    // Apply instance overrides (text content on nested children)
    if (child.instanceOverrides) {
      await applyInstanceOverrides(instance, child.instanceOverrides);
    }

    if (child.styles) {
      await applyStyles(instance, child.styles);
      applyLayoutSizing(instance, child.styles);
    }

    if (child.visibleBindTo) {
      (instance as SceneNode & { componentPropertyReferences?: Record<string, string> }).componentPropertyReferences = { visible: child.visibleBindTo };
    }

    return instance;
  }

  // Fallback: if instance child has children, build as FRAME (graceful degradation)
  if (child.children && child.children.length > 0) {
    if (notes) {
      notes.push(`instance "${child.name}" ref "${ref}" not found, built as FRAME with inline children`);
    }
    return await buildFrameChild(child, parent, notes);
  }

  // Last resort: placeholder
  const placeholder = figma.createFrame();
  placeholder.name = child.name;
  placeholder.resize(100, 40);
  parent.appendChild(placeholder);

  if (notes) {
    notes.push(`instance "${child.name}" ref "${ref ?? "unknown"}" not found, placeholder created`);
  }

  const label = figma.createText();
  await figma.loadFontAsync(DEFAULT_FONT);
  label.fontName = DEFAULT_FONT;
  label.characters = `(missing: ${ref ?? "unknown"})`;
  label.fontSize = 10;
  placeholder.appendChild(label);

  if (child.styles) {
    await applyStyles(placeholder, child.styles);
  }

  if (child.visibleBindTo) {
    (placeholder as SceneNode & { componentPropertyReferences?: Record<string, string> }).componentPropertyReferences = { visible: child.visibleBindTo };
  }

  return placeholder;
}

async function applyInstanceOverrides(
  instance: InstanceNode,
  overrides: Record<string, { textContent?: string }>,
): Promise<void> {
  for (const [childName, override] of Object.entries(overrides)) {
    if (!override.textContent) continue;

    // Find the text node within the instance by name
    const textNode = instance.findOne(
      (n) => n.type === "TEXT" && n.name === childName,
    ) as TextNode | null;

    if (textNode) {
      await figma.loadFontAsync(textNode.fontName as FontName);
      textNode.characters = override.textContent;
    }
  }
}

async function buildFrameChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
  notes?: string[],
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = child.name;
  parent.appendChild(frame);

  if (child.layout) {
    applyLayout(frame, child.layout);
  }

  await applyStyles(frame, child.styles ?? {});
  if (child.styles) {
    applyLayoutSizing(frame, child.styles);
  }

  if (child.children) {
    for (const c of child.children) {
      await buildChild(c, frame, notes);
    }
  }

  if (child.visibleBindTo) {
    (frame as SceneNode & { componentPropertyReferences?: Record<string, string> }).componentPropertyReferences = { visible: child.visibleBindTo };
  }

  return frame;
}

function buildRectangleChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = child.name;
  parent.appendChild(rect);
  // Styles are applied by the caller (buildChild) after creation.
  return rect;
}

function buildEllipseChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): EllipseNode {
  const ellipse = figma.createEllipse();
  ellipse.name = child.name;
  parent.appendChild(ellipse);
  return ellipse;
}

function buildPolygonChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): PolygonNode {
  const polygon = figma.createPolygon();
  polygon.name = child.name;
  if (child.pointCount !== undefined) {
    polygon.pointCount = child.pointCount;
  }
  parent.appendChild(polygon);
  return polygon;
}

function buildStarChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): StarNode {
  const star = figma.createStar();
  star.name = child.name;
  if (child.pointCount !== undefined) {
    star.pointCount = child.pointCount;
  }
  if (child.innerRadius !== undefined) {
    star.innerRadius = child.innerRadius;
  }
  parent.appendChild(star);
  return star;
}

function buildLineChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): LineNode {
  const line = figma.createLine();
  line.name = child.name;
  parent.appendChild(line);
  return line;
}

function buildVectorChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): VectorNode {
  const vector = figma.createVector();
  vector.name = child.name;
  if (child.vectorPaths) {
    vector.vectorPaths = child.vectorPaths;
  }
  parent.appendChild(vector);
  return vector;
}

// ---------------------------------------------------------------------------
// Font pre-loading — collect all unique fonts from a descriptor and load once
// ---------------------------------------------------------------------------

function collectFontsFromTextStyles(
  ts: ComponentDescriptorTextStyles | undefined,
  fonts: Set<string>,
): void {
  if (!ts) return;
  const family = ts.fontFamily ?? DEFAULT_FONT.family;
  const style = ts.fontWeight ? fontWeightToStyle(ts.fontWeight) : DEFAULT_FONT.style;
  fonts.add(`${family}\0${style}`);
}

function collectFontsFromChildren(
  children: ComponentDescriptorChild[] | undefined,
  fonts: Set<string>,
): void {
  if (!children) return;
  for (const child of children) {
    if (child.type === "TEXT") {
      collectFontsFromTextStyles(child.textStyles, fonts);
    }
    collectFontsFromChildren(child.children, fonts);
  }
}

function collectAllFonts(json: ComponentDescriptor): Set<string> {
  const fonts = new Set<string>();
  // Always include default font
  fonts.add(`${DEFAULT_FONT.family}\0${DEFAULT_FONT.style}`);
  // Base children
  collectFontsFromChildren(json.children, fonts);
  // Variant child overrides
  for (const v of json.variants ?? []) {
    for (const childOverride of Object.values(v.overrides.children ?? {})) {
      collectFontsFromTextStyles(childOverride.textStyles, fonts);
    }
    collectFontsFromChildren(v.overrides.addedChildren, fonts);
  }
  return fonts;
}

async function preloadFonts(json: ComponentDescriptor): Promise<void> {
  const fonts = collectAllFonts(json);
  await Promise.all(
    [...fonts].map((key) => {
      const [family, style] = key.split("\0");
      return figma.loadFontAsync({ family, style });
    }),
  );
}

// ---------------------------------------------------------------------------
// Variant helpers
// ---------------------------------------------------------------------------

function mergeStyles(
  base: ComponentDescriptorStyles | undefined,
  overrides: Partial<ComponentDescriptorStyles> | undefined,
): ComponentDescriptorStyles | undefined {
  if (!overrides) return base;
  if (!base) return overrides as ComponentDescriptorStyles;
  return { ...base, ...overrides };
}

function mergeLayout(
  base: ComponentDescriptorLayout | undefined,
  overrides: Partial<ComponentDescriptorLayout> | undefined,
): ComponentDescriptorLayout | undefined {
  if (!overrides) return base;
  if (!base) return overrides as ComponentDescriptorLayout;
  return { ...base, ...overrides };
}

function mergeTextStyles(
  base: ComponentDescriptorTextStyles | undefined,
  overrides: Partial<ComponentDescriptorTextStyles> | undefined,
): ComponentDescriptorTextStyles | undefined {
  if (!overrides) return base;
  if (!base) return overrides as ComponentDescriptorTextStyles;
  return { ...base, ...overrides };
}

function buildVariantName(props: Record<string, string>): string {
  return Object.entries(props)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

/**
 * Sort variant components so they form a logical grid:
 * - Sorted by each VARIANT property in declaration order
 * - Within each property, sorted by option index (declaration order)
 * Result: with properties [Variant(4), State(5), Size(3)], layout becomes
 * rows grouped by Variant → State, columns by Size.
 */
function sortVariantComponents(
  components: ComponentNode[],
  variantProps: ComponentDescriptorProperty[],
): ComponentNode[] {
  if (variantProps.length === 0) return components;

  // Build option→index maps for each property
  const optionIndexMaps = variantProps.map((prop) => {
    const map = new Map<string, number>();
    (prop.options ?? []).forEach((opt, idx) => map.set(opt, idx));
    return map;
  });

  // Parse "Variant=Primary, State=Default, Size=SM" into Map
  function parsePropValues(name: string): Map<string, string> {
    const result = new Map<string, string>();
    for (const part of name.split(", ")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx >= 0) {
        result.set(part.slice(0, eqIdx), part.slice(eqIdx + 1));
      }
    }
    return result;
  }

  return [...components].sort((a, b) => {
    const aProps = parsePropValues(a.name);
    const bProps = parsePropValues(b.name);

    for (let i = 0; i < variantProps.length; i++) {
      const propName = variantProps[i].name;
      const aIdx = optionIndexMaps[i].get(aProps.get(propName) ?? "") ?? 999;
      const bIdx = optionIndexMaps[i].get(bProps.get(propName) ?? "") ?? 999;
      if (aIdx !== bIdx) return aIdx - bIdx;
    }
    return 0;
  });
}

/**
 * Find the base variant's property values — the combination NOT present
 * in the overrides list. Falls back to property defaults if no conflict.
 */
function findBaseVariantProps(json: ComponentDescriptor): Record<string, string> {
  const variantProps = (json.properties ?? []).filter((p) => p.type === "VARIANT");
  if (variantProps.length === 0) return {};

  const propNames = variantProps.map((vp) => vp.name);
  const overrideKeys = new Set(
    (json.variants ?? []).map((v) =>
      propNames.map((name) => v.props[name] ?? "").join("\0"),
    ),
  );

  // Try defaults first
  const defaultProps: Record<string, string> = {};
  for (const vp of variantProps) {
    defaultProps[vp.name] = String(vp.default ?? vp.options?.[0] ?? "default");
  }
  const defaultKey = propNames.map((name) => defaultProps[name]).join("\0");
  if (!overrideKeys.has(defaultKey)) return defaultProps;

  // Conflict: enumerate all combinations to find the missing one
  function findMissing(
    idx: number,
    current: Record<string, string>,
  ): Record<string, string> | null {
    if (idx >= variantProps.length) {
      const key = propNames.map((name) => current[name]).join("\0");
      return overrideKeys.has(key) ? null : { ...current };
    }
    for (const opt of variantProps[idx].options ?? []) {
      current[variantProps[idx].name] = opt;
      const result = findMissing(idx + 1, current);
      if (result) return result;
    }
    return null;
  }

  return findMissing(0, {}) ?? defaultProps;
}

async function buildVariantComponent(
  json: ComponentDescriptor,
  variantOverride: ComponentDescriptorVariantOverride | null,
  parent: ChildrenMixin,
  notes?: string[],
  baseProps?: Record<string, string>,
): Promise<ComponentNode> {
  const comp = figma.createComponent();

  if (variantOverride) {
    comp.name = buildVariantName(variantOverride.props);
  } else if (baseProps && Object.keys(baseProps).length > 0) {
    comp.name = buildVariantName(baseProps);
  } else {
    comp.name = json.name;
  }

  parent.appendChild(comp);

  // Merge layout
  const layout = mergeLayout(json.layout, variantOverride?.overrides.layout);
  if (layout) {
    applyLayout(comp, layout as ComponentDescriptorLayout);
  }

  // Merge styles
  const styles = mergeStyles(json.styles, variantOverride?.overrides.styles);
  await applyStyles(comp, (styles as ComponentDescriptorStyles) ?? {});

  // Build children (with optional child overrides and ordering)
  const removedSet = new Set(variantOverride?.overrides.removedChildren ?? []);
  const childOrder = variantOverride?.overrides.childOrder;
  if (json.children) {
    // Reorder children if variant specifies a different order
    let orderedChildren = json.children;
    if (childOrder) {
      const childMap = new Map(json.children.map((c) => [c.name, c]));
      orderedChildren = childOrder
        .filter((name) => childMap.has(name))
        .map((name) => childMap.get(name)!);
      // Append any children not in childOrder (shouldn't happen, but defensive)
      for (const c of json.children) {
        if (!childOrder.includes(c.name)) orderedChildren.push(c);
      }
    }
    for (const childDef of orderedChildren) {
      // Skip children removed in this variant
      if (removedSet.has(childDef.name)) continue;

      const childOverride = variantOverride?.overrides.children?.[childDef.name];

      // Apply child-level overrides
      const mergedChild: ComponentDescriptorChild = { ...childDef };
      if (childOverride) {
        mergedChild.styles = mergeStyles(childDef.styles, childOverride.styles) as
          | ComponentDescriptorStyles
          | undefined;
        mergedChild.textStyles = mergeTextStyles(childDef.textStyles, childOverride.textStyles) as
          | ComponentDescriptorTextStyles
          | undefined;
        if (childOverride.textContent !== undefined) {
          mergedChild.textContent = childOverride.textContent;
        }
        if (childOverride.rotation !== undefined) {
          mergedChild.rotation = childOverride.rotation;
        }
        if (childOverride.vectorPaths !== undefined) {
          mergedChild.vectorPaths = childOverride.vectorPaths;
        }
      }

      try {
        await buildChild(mergedChild, comp, notes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (notes) notes.push(`CHILD "${mergedChild.name}" FAILED: ${msg}`);
        console.error(`buildChild "${mergedChild.name}" failed:`, err);
      }
    }
  }

  // Build children added only in this variant
  if (variantOverride?.overrides.addedChildren) {
    for (const addedChild of variantOverride.overrides.addedChildren) {
      try {
        await buildChild(addedChild, comp, notes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (notes) notes.push(`CHILD "${addedChild.name}" FAILED: ${msg}`);
        console.error(`buildChild "${addedChild.name}" failed:`, err);
      }
    }
  }

  return comp;
}

// ---------------------------------------------------------------------------
// Top-level builders
// ---------------------------------------------------------------------------

function hasVariantProperties(json: ComponentDescriptor): boolean {
  if ((json.properties ?? []).some((p) => p.type === "VARIANT")) return true;
  // Fallback: if variants array exists, treat as ComponentSet even if
  // properties are missing (e.g. extractProperties failed on validation errors)
  return (json.variants ?? []).length > 0;
}

function addNonVariantProperties(
  target: ComponentNode | ComponentSetNode,
  properties: ComponentDescriptorProperty[],
): void {
  for (const prop of properties) {
    if (prop.type === "VARIANT") continue;
    target.addComponentProperty(
      prop.name,
      prop.type,
      prop.default ?? (prop.type === "BOOLEAN" ? true : ""),
    );
  }
}

async function buildSingleComponent(json: ComponentDescriptor): Promise<ComponentNode> {
  const syncNotes: string[] = [...(json.syncNotes ?? [])];

  const comp = figma.createComponent();
  comp.name = json.name;

  figma.currentPage.appendChild(comp);

  if (json.layout) {
    applyLayout(comp, json.layout);
  }

  await applyStyles(comp, json.styles ?? {});

  // Build children
  if (json.children) {
    for (const childDef of json.children) {
      try {
        await buildChild(childDef, comp, syncNotes);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        syncNotes.push(`CHILD "${childDef.name}" FAILED: ${msg}`);
        console.error(`buildChild "${childDef.name}" failed:`, err);
      }
    }
  }

  // Add properties (no VARIANT props for single components)
  if (json.properties) {
    addNonVariantProperties(comp, json.properties);
  }

  // Write description with sync notes
  comp.description = updateSyncNotes(json.description ?? "", syncNotes);

  return comp;
}

async function buildComponentSet(json: ComponentDescriptor): Promise<ComponentSetNode> {
  const syncNotes: string[] = [...(json.syncNotes ?? [])];
  let variantProps = (json.properties ?? []).filter((p) => p.type === "VARIANT");

  // Infer VARIANT properties from the variants array when properties are missing
  // (e.g. componentPropertyDefinitions threw during extraction)
  if (variantProps.length === 0 && json.variants && json.variants.length > 0) {
    const propValuesMap = new Map<string, Set<string>>();
    for (const v of json.variants) {
      for (const [key, value] of Object.entries(v.props)) {
        if (!propValuesMap.has(key)) propValuesMap.set(key, new Set());
        propValuesMap.get(key)!.add(value);
      }
    }
    variantProps = [...propValuesMap.entries()].map(([name, values]) => ({
      name,
      type: "VARIANT" as const,
      options: [...values],
      default: [...values][0],
    }));
  }

  const propNames = variantProps.map((vp) => vp.name);

  // Pre-load ALL fonts upfront to avoid repeated async loads per variant
  await preloadFonts(json);

  // Create a temporary frame to hold variant components before combining
  const tempFrame = figma.createFrame();
  tempFrame.name = "__temp_variant_holder__";
  figma.currentPage.appendChild(tempFrame);

  try {
    const variantComponents: ComponentNode[] = [];
    const errors: string[] = [];

    // Determine the base variant's property values
    const baseProps = findBaseVariantProps(json);
    const baseKey = propNames.map((n) => baseProps[n]).join("\0");

    // Check if the default combination is already listed as an override.
    // If so, use the override data for the base (prevents duplicate names).
    const baseOverrideIdx = (json.variants ?? []).findIndex(
      (v) => propNames.map((n) => v.props[n] ?? "").join("\0") === baseKey,
    );

    // Helper: build a single variant with error recovery
    async function safeBuildVariant(
      override: ComponentDescriptorVariantOverride | null,
      bProps?: Record<string, string>,
    ): Promise<ComponentNode | null> {
      try {
        return await buildVariantComponent(json, override, tempFrame, syncNotes, bProps);
      } catch (err) {
        const name = override
          ? buildVariantName(override.props)
          : buildVariantName(bProps ?? {});
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        return null;
      }
    }

    if (baseOverrideIdx >= 0 && json.variants) {
      // Base combination IS in overrides — build it with its override data
      const baseComp = await safeBuildVariant(json.variants[baseOverrideIdx]);
      if (baseComp) variantComponents.push(baseComp);

      // Build remaining overrides (skip the base)
      for (let i = 0; i < json.variants.length; i++) {
        if (i === baseOverrideIdx) continue;
        const varComp = await safeBuildVariant(json.variants[i]);
        if (varComp) variantComponents.push(varComp);
      }
    } else {
      // Base combination NOT in overrides — build from top-level descriptor
      const baseComp = await safeBuildVariant(null, baseProps);
      if (baseComp) variantComponents.push(baseComp);

      // Build all overrides
      if (json.variants) {
        for (const v of json.variants) {
          const varComp = await safeBuildVariant(v);
          if (varComp) variantComponents.push(varComp);
        }
      }
    }

    if (errors.length > 0) {
      figma.notify(`${errors.length} variant(s) failed: ${errors[0]}`, { error: true, timeout: 8000 });
    }

    if (variantComponents.length < 2) {
      throw new Error(
        `Only ${variantComponents.length} variant(s) built (need ≥2). Errors: ${errors.join("; ")}`,
      );
    }

    // Combine as variants, then reorder children for organized grid layout
    const componentSet = figma.combineAsVariants(variantComponents, figma.currentPage);
    componentSet.name = json.name;

    // Reorder children after combining (combineAsVariants doesn't preserve input order)
    const sortedChildren = sortVariantComponents(
      [...componentSet.children] as ComponentNode[],
      variantProps,
    );
    for (let i = 0; i < sortedChildren.length; i++) {
      componentSet.insertChild(i, sortedChildren[i]);
    }

    // Write description with sync notes
    componentSet.description = updateSyncNotes(json.description ?? "", syncNotes);

    // Grid auto layout for organized variant display
    componentSet.layoutMode = "HORIZONTAL";
    componentSet.layoutWrap = "WRAP";
    componentSet.counterAxisSizingMode = "AUTO";
    componentSet.paddingTop = 40;
    componentSet.paddingRight = 40;
    componentSet.paddingBottom = 40;
    componentSet.paddingLeft = 40;
    componentSet.itemSpacing = 24;
    componentSet.counterAxisSpacing = 24;
    componentSet.cornerRadius = 4;
    const bg = hexToRgb("00471C");
    componentSet.fills = [
      { type: "SOLID", color: { r: bg.r, g: bg.g, b: bg.b }, opacity: 1 },
    ];

    // Column count from LAST VARIANT property's options (innermost dimension),
    // so each row shows all values of the last property (e.g. Size: SM, MD, LG)
    const totalVariants = componentSet.children.length;
    const lastVP = variantProps[variantProps.length - 1];
    const cols =
      variantProps.length > 0 && lastVP?.options && lastVP.options.length > 0
        ? lastVP.options.length
        : Math.ceil(Math.sqrt(totalVariants));
    let maxChildW = 0;
    for (const child of componentSet.children) {
      if (child.width > maxChildW) maxChildW = child.width;
    }
    componentSet.resize(
      40 * 2 + maxChildW * cols + 24 * Math.max(0, cols - 1),
      componentSet.height,
    );

    // Add non-variant properties to the component set
    if (json.properties) {
      addNonVariantProperties(componentSet, json.properties);
    }

    return componentSet;
  } finally {
    // Always clean up temp frame (combineAsVariants moves children out,
    // but if an error occurred the frame may still have orphans)
    if (tempFrame.parent) {
      tempFrame.remove();
    }
  }
}

// ---------------------------------------------------------------------------
// Update existing node (upsert)
// ---------------------------------------------------------------------------

/**
 * Collects all instances of a component (or component set's variants)
 * before deletion, so they can be reconnected after rebuild via swapComponent.
 */
async function collectInstances(
  node: SceneNode,
): Promise<Map<string, InstanceNode[]>> {
  const instanceMap = new Map<string, InstanceNode[]>();

  if (node.type === "COMPONENT") {
    const instances = await (node as ComponentNode).getInstancesAsync();
    if (instances.length > 0) {
      instanceMap.set(node.name, instances);
    }
  } else if (node.type === "COMPONENT_SET") {
    for (const child of (node as ComponentSetNode).children) {
      if (child.type === "COMPONENT") {
        const instances = await (child as ComponentNode).getInstancesAsync();
        if (instances.length > 0) {
          instanceMap.set(child.name, instances);
        }
      }
    }
  }

  return instanceMap;
}

/**
 * Parse "Variant=Primary, Size=SM" into key=value pairs.
 */
function parseVariantProps(name: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of name.split(", ")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx >= 0) {
      result.set(part.slice(0, eqIdx), part.slice(eqIdx + 1));
    }
  }
  return result;
}

/**
 * Find the best matching variant by comparing prop values.
 * Returns the variant with the most overlapping key=value pairs.
 */
function findBestVariantMatch(
  variantName: string,
  variantMap: Map<string, ComponentNode>,
): ComponentNode | undefined {
  const oldProps = parseVariantProps(variantName);
  if (oldProps.size === 0) return undefined;

  let bestMatch: ComponentNode | undefined;
  let bestScore = 0;

  for (const [name, comp] of variantMap) {
    const newProps = parseVariantProps(name);
    let score = 0;
    for (const [key, value] of oldProps) {
      if (newProps.get(key) === value) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = comp;
    }
  }

  return bestScore > 0 ? bestMatch : undefined;
}

/**
 * Reconnects orphaned instances to newly built components via swapComponent.
 * For single components, maps by component name.
 * For component sets, maps by variant name (e.g. "Variant=Primary, Size=SM").
 * Falls back to prop-based partial matching when exact name match fails.
 * Returns the set of parent component node IDs that were affected by swapComponent.
 */
function reconnectInstances(
  newNode: SceneNode,
  instanceMap: Map<string, InstanceNode[]>,
): Set<string> {
  const affectedParents = new Set<string>();
  if (instanceMap.size === 0) return affectedParents;

  function trackParentComponent(inst: InstanceNode) {
    let p: BaseNode | null = inst.parent;
    while (p) {
      if (p.type === "COMPONENT" || p.type === "COMPONENT_SET") {
        affectedParents.add(p.id);
        break;
      }
      p = p.parent;
    }
  }

  if (newNode.type === "COMPONENT") {
    // Single component: reconnect all collected instances
    for (const instances of instanceMap.values()) {
      for (const inst of instances) {
        if (!inst.removed && inst.type === "INSTANCE") {
          trackParentComponent(inst);
          inst.swapComponent(newNode as ComponentNode);
        }
      }
    }
  } else if (newNode.type === "COMPONENT_SET") {
    // Component set: match by variant name
    const variantMap = new Map<string, ComponentNode>();
    for (const child of (newNode as ComponentSetNode).children) {
      if (child.type === "COMPONENT") {
        variantMap.set(child.name, child as ComponentNode);
      }
    }

    for (const [variantName, instances] of instanceMap) {
      let newVariant = variantMap.get(variantName);

      // Fallback: find best partial match by prop values
      if (!newVariant) {
        newVariant = findBestVariantMatch(variantName, variantMap);
      }

      if (newVariant) {
        for (const inst of instances) {
          if (!inst.removed && inst.type === "INSTANCE") {
            trackParentComponent(inst);
            inst.swapComponent(newVariant);
          }
        }
      }
    }
  }

  return affectedParents;
}

/**
 * Finds orphaned instances (whose mainComponent was deleted) matching the
 * given component name. Uses getMainComponentAsync to support dynamic-page
 * document access mode.
 */
async function findOrphanedInstances(
  componentName: string,
): Promise<Map<string, InstanceNode[]>> {
  const instanceMap = new Map<string, InstanceNode[]>();

  const allInstances = figma.root.findAll(
    (n) => n.type === "INSTANCE",
  ) as InstanceNode[];

  for (const inst of allInstances) {
    try {
      const mc = await inst.getMainComponentAsync();
      if (!mc || mc.removed || !isOnPage(mc)) {
        // Orphaned — match by mainComponent name
        let matchKey: string | undefined;
        if (mc) {
          if (mc.name === componentName) {
            matchKey = mc.name;
          } else if (
            mc.parent &&
            mc.parent.type === "COMPONENT_SET" &&
            mc.parent.name === componentName
          ) {
            matchKey = mc.name;
          }
        }

        if (matchKey) {
          const existing = instanceMap.get(matchKey) || [];
          existing.push(inst);
          instanceMap.set(matchKey, existing);
        }
      }
    } catch {
      // Cannot resolve mainComponent at all — skip
    }
  }

  return instanceMap;
}

/**
 * Replaces orphaned instances with fresh instances of the new component.
 * Unlike reconnectInstances (which uses swapComponent and preserves overrides),
 * this creates clean instances so stale inherited-turned-override values
 * (e.g. color changes made before deletion) don't persist.
 */
function replaceOrphanedInstances(
  newNode: SceneNode,
  instanceMap: Map<string, InstanceNode[]>,
): Set<string> {
  const affectedParents = new Set<string>();
  if (instanceMap.size === 0) return affectedParents;

  function trackParentComponent(inst: InstanceNode) {
    let p: BaseNode | null = inst.parent;
    while (p) {
      if (p.type === "COMPONENT" || p.type === "COMPONENT_SET") {
        affectedParents.add(p.id);
        break;
      }
      p = p.parent;
    }
  }

  function replaceOne(inst: InstanceNode, comp: ComponentNode) {
    trackParentComponent(inst);

    const parent = inst.parent;
    if (!parent || !("children" in parent)) {
      inst.swapComponent(comp);
      return;
    }

    const parentChildren = (parent as ChildrenMixin).children;
    let idx = -1;
    for (let i = 0; i < parentChildren.length; i++) {
      if (parentChildren[i] === inst) {
        idx = i;
        break;
      }
    }

    if (idx < 0) {
      inst.swapComponent(comp);
      return;
    }

    const x = inst.x;
    const y = inst.y;

    inst.remove();

    const fresh = comp.createInstance();
    (parent as ChildrenMixin).insertChild(idx, fresh);
    fresh.x = x;
    fresh.y = y;
  }

  if (newNode.type === "COMPONENT") {
    for (const instances of instanceMap.values()) {
      for (const inst of instances) {
        if (!inst.removed && inst.type === "INSTANCE") {
          replaceOne(inst, newNode as ComponentNode);
        }
      }
    }
  } else if (newNode.type === "COMPONENT_SET") {
    const variantMap = new Map<string, ComponentNode>();
    for (const child of (newNode as ComponentSetNode).children) {
      if (child.type === "COMPONENT") {
        variantMap.set(child.name, child as ComponentNode);
      }
    }

    for (const [variantName, instances] of instanceMap) {
      const newVariant =
        variantMap.get(variantName) ||
        findBestVariantMatch(variantName, variantMap);
      if (newVariant) {
        for (const inst of instances) {
          if (!inst.removed && inst.type === "INSTANCE") {
            replaceOne(inst, newVariant);
          }
        }
      }
    }
  }

  return affectedParents;
}

/**
 * Delete-and-rebuild strategy with instance reconnection via swapComponent.
 * Instances of the old component are collected before deletion and
 * reconnected to the new component after rebuild, preserving instance
 * relationships (e.g. compA containing comp1 instances).
 *
 * @returns Object with the NEW node ID and affected parent component IDs.
 */
async function updateExistingNode(
  existing: SceneNode,
  json: ComponentDescriptor,
): Promise<{ newNodeId: string; affectedParents: string[] }> {
  const x = existing.x;
  const y = existing.y;
  const parentNode = existing.parent;
  const oldName = existing.name;

  // Collect instances BEFORE deleting
  const instanceMap = await collectInstances(existing);

  existing.remove();

  // Remove old name from cache so stale references aren't used
  if (_compCache) {
    _compCache.delete(oldName);
  }

  // Rebuild
  let newNode: SceneNode;
  if (hasVariantProperties(json)) {
    newNode = await buildComponentSet(json);
  } else {
    newNode = await buildSingleComponent(json);
  }

  // Reconnect orphaned instances to new component
  const affectedParents = reconnectInstances(newNode, instanceMap);

  // Update _compCache with the new node so subsequent builds can reference it
  if (_compCache) {
    if (newNode.type === "COMPONENT" || newNode.type === "COMPONENT_SET") {
      _compCache.set(newNode.name, newNode);
    }
  }

  newNode.x = x;
  newNode.y = y;

  if (parentNode && "appendChild" in parentNode && parentNode !== newNode.parent) {
    (parentNode as ChildrenMixin).appendChild(newNode);
    newNode.x = x;
    newNode.y = y;
  }

  // Remove self from affected parents (it was just rebuilt)
  affectedParents.delete(newNode.id);

  return { newNodeId: newNode.id, affectedParents: [...affectedParents] };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function applyComponentJSON(
  nodeId: string,
  json: ComponentDescriptor,
): Promise<{ nodeId: string; affectedParents: string[] }> {
  // Pre-populate lookup caches so that variable/component resolution is O(1)
  // instead of hitting figma.variables.getLocalVariablesAsync / figma.root.findAll
  // on every fill, stroke, or instance child.
  await initCaches();

  try {
    // 1. Try to find existing node
    const existing = await figma.getNodeByIdAsync(nodeId);

    if (existing && !existing.removed && isOnPage(existing) && existing.type !== "DOCUMENT" && existing.type !== "PAGE") {
      const result = await updateExistingNode(existing as SceneNode, json);
      return { nodeId: result.newNodeId, affectedParents: result.affectedParents };
    }

    // 2. Create new — position after the last node on the current page
    const page = figma.currentPage;
    const children = page.children;
    let newNode: SceneNode;

    if (hasVariantProperties(json)) {
      newNode = await buildComponentSet(json);
    } else {
      newNode = await buildSingleComponent(json);
    }

    // Position below the last existing node
    if (children.length > 1) {
      // children includes the newly created node, so look at the second-to-last
      const lastExisting = children[children.length - 2];
      newNode.x = lastExisting.x;
      newNode.y = lastExisting.y + lastExisting.height + 100;
    }

    // Replace orphaned instances with fresh ones (no stale overrides)
    const orphanedInstances = await findOrphanedInstances(json.name);
    const totalOrphans = [...orphanedInstances.values()].reduce((s, a) => s + a.length, 0);
    if (totalOrphans > 0) {
      figma.notify(`Reconnecting ${totalOrphans} orphaned instance(s) of "${json.name}"`, { timeout: 5000 });
    }
    const affectedParents = replaceOrphanedInstances(newNode, orphanedInstances);
    affectedParents.delete(newNode.id);

    return { nodeId: newNode.id, affectedParents: [...affectedParents] };
  } finally {
    clearCaches();
  }
}
