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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  let h = hex.replace(/^#/, "");

  // Expand 3-char shorthand (e.g. "f0a" → "ff00aa")
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  // 4-char shorthand with alpha (e.g. "f0a8" → "ff00aa88")
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }

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
// Apply fills / strokes / effects / cornerRadius / layout / styles
// ---------------------------------------------------------------------------

async function findVariableByName(name: string): Promise<Variable | null> {
  const allVars = await figma.variables.getLocalVariablesAsync("COLOR");
  return allVars.find((v) => v.name === name) ?? null;
}

async function applyFills(
  node: GeometryMixin | MinimalFillsMixin,
  fills: ComponentDescriptorFill[],
): Promise<void> {
  const paints: SolidPaint[] = [];

  for (const fill of fills) {
    const { r, g, b, a } = hexToRgb(fill.color);
    let paint: SolidPaint = {
      type: "SOLID",
      color: { r, g, b },
      opacity: fill.opacity ?? a,
    };

    if (fill.boundVariable) {
      const variable = await findVariableByName(fill.boundVariable);
      if (variable) {
        paint = figma.variables.setBoundVariableForPaint(paint, "color", variable);
      }
    }

    paints.push(paint);
  }

  node.fills = paints;
}

async function applyStrokes(
  node: GeometryMixin | MinimalStrokesMixin,
  strokes: ComponentDescriptorStroke[],
): Promise<void> {
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
      const variable = await findVariableByName(stroke.boundVariable);
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
}

async function applyStyles(node: SceneNode, styles: ComponentDescriptorStyles): Promise<void> {
  if (styles.width !== undefined && styles.height !== undefined) {
    (node as FrameNode).resize(styles.width, styles.height);
  } else if (styles.width !== undefined) {
    (node as FrameNode).resize(styles.width, (node as FrameNode).height);
  } else if (styles.height !== undefined) {
    (node as FrameNode).resize((node as FrameNode).width, styles.height);
  }

  if (styles.fills && "fills" in node) {
    await applyFills(node as GeometryMixin, styles.fills);
  }

  if (styles.strokes && "strokes" in node) {
    await applyStrokes(node as GeometryMixin, styles.strokes);
  }

  if (styles.effects && "effects" in node) {
    applyEffects(node as BlendMixin, styles.effects);
  }

  if (styles.cornerRadius !== undefined) {
    applyCornerRadius(node, styles.cornerRadius);
  }
}

async function applyTextStyles(node: TextNode, ts: ComponentDescriptorTextStyles): Promise<void> {
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
    node.letterSpacing = { value: ts.letterSpacing, unit: "PIXELS" };
  }

  if (ts.textAlignHorizontal) {
    node.textAlignHorizontal = ts.textAlignHorizontal;
  }

  if (ts.fills) {
    await applyFills(node, ts.fills);
  }
}

// ---------------------------------------------------------------------------
// Build children
// ---------------------------------------------------------------------------

async function buildChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): Promise<SceneNode> {
  switch (child.type) {
    case "TEXT":
      return await buildTextChild(child, parent);
    case "INSTANCE":
      return await buildInstanceChild(child, parent);
    case "FRAME":
      return await buildFrameChild(child, parent);
    case "RECTANGLE":
      return buildRectangleChild(child, parent);
    case "ELLIPSE":
      return buildEllipseChild(child, parent);
    case "VECTOR":
      // Vector nodes cannot be fully created via Plugin API;
      // create a placeholder rectangle instead.
      return buildRectangleChild(child, parent);
  }
}

async function buildTextChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): Promise<TextNode> {
  const text = figma.createText();
  text.name = child.name;
  parent.appendChild(text);

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

  if (child.textStyles) {
    await applyTextStyles(text, child.textStyles);
  }

  if (child.styles) {
    await applyStyles(text, child.styles);
  }

  return text;
}

async function buildInstanceChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): Promise<SceneNode> {
  if (child.componentRef) {
    // Search for the referenced component
    const found = figma.root.findAll(
      (n) =>
        (n.type === "COMPONENT" || n.type === "COMPONENT_SET") &&
        n.name === child.componentRef,
    );

    if (found.length > 0) {
      const target = found[0];
      let comp: ComponentNode;
      if (target.type === "COMPONENT_SET") {
        // Use the default variant
        comp = (target as ComponentSetNode).defaultVariant;
      } else {
        comp = target as ComponentNode;
      }
      const instance = comp.createInstance();
      instance.name = child.name;
      parent.appendChild(instance);

      if (child.styles) {
        await applyStyles(instance, child.styles);
      }

      return instance;
    }
  }

  // Fallback: create a placeholder frame
  const placeholder = figma.createFrame();
  placeholder.name = child.name;
  placeholder.resize(100, 40);
  parent.appendChild(placeholder);

  // Add a "(missing: RefName)" label
  const label = figma.createText();
  await figma.loadFontAsync(DEFAULT_FONT);
  label.fontName = DEFAULT_FONT;
  label.characters = `(missing: ${child.componentRef ?? "unknown"})`;
  label.fontSize = 10;
  placeholder.appendChild(label);

  if (child.styles) {
    await applyStyles(placeholder, child.styles);
  }

  return placeholder;
}

async function buildFrameChild(
  child: ComponentDescriptorChild,
  parent: ChildrenMixin,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = child.name;
  parent.appendChild(frame);

  if (child.layout) {
    applyLayout(frame, child.layout);
  }

  if (child.styles) {
    await applyStyles(frame, child.styles);
  }

  if (child.children) {
    for (const c of child.children) {
      await buildChild(c, frame);
    }
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

  // applyStyles is async but we return sync — caller handles awaiting via
  // the async wrapper in buildChild. For shapes we can safely apply sync-only
  // portions and queue the async work.
  // However, since buildChild is already async, we handle this in the caller.
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

async function buildVariantComponent(
  json: ComponentDescriptor,
  variantOverride: ComponentDescriptorVariantOverride | null,
  parent: ChildrenMixin,
): Promise<ComponentNode> {
  const comp = figma.createComponent();

  if (variantOverride) {
    comp.name = buildVariantName(variantOverride.props);
  } else {
    // Base variant: build name from default values of VARIANT properties
    const variantProps = (json.properties ?? []).filter((p) => p.type === "VARIANT");
    if (variantProps.length > 0) {
      const defaultProps: Record<string, string> = {};
      for (const vp of variantProps) {
        defaultProps[vp.name] = String(vp.default ?? vp.options?.[0] ?? "default");
      }
      comp.name = buildVariantName(defaultProps);
    } else {
      comp.name = json.name;
    }
  }

  parent.appendChild(comp);

  // Merge layout
  const layout = mergeLayout(json.layout, variantOverride?.overrides.layout);
  if (layout) {
    applyLayout(comp, layout as ComponentDescriptorLayout);
  }

  // Merge styles
  const styles = mergeStyles(json.styles, variantOverride?.overrides.styles);
  if (styles) {
    await applyStyles(comp, styles as ComponentDescriptorStyles);
  }

  // Build children (with optional child overrides)
  if (json.children) {
    for (const childDef of json.children) {
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
      }

      const node = await buildChild(mergedChild, comp);

      // Apply styles for RECTANGLE / ELLIPSE (sync creation, async styles)
      if (
        (mergedChild.type === "RECTANGLE" || mergedChild.type === "ELLIPSE" || mergedChild.type === "VECTOR") &&
        mergedChild.styles
      ) {
        await applyStyles(node, mergedChild.styles);
      }
    }
  }

  return comp;
}

// ---------------------------------------------------------------------------
// Top-level builders
// ---------------------------------------------------------------------------

function hasVariantProperties(json: ComponentDescriptor): boolean {
  return (json.properties ?? []).some((p) => p.type === "VARIANT");
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
  const comp = figma.createComponent();
  comp.name = json.name;

  if (json.description) {
    comp.description = json.description;
  }

  figma.currentPage.appendChild(comp);

  if (json.layout) {
    applyLayout(comp, json.layout);
  }

  if (json.styles) {
    await applyStyles(comp, json.styles);
  }

  // Build children
  if (json.children) {
    for (const childDef of json.children) {
      const node = await buildChild(childDef, comp);
      if (
        (childDef.type === "RECTANGLE" || childDef.type === "ELLIPSE" || childDef.type === "VECTOR") &&
        childDef.styles
      ) {
        await applyStyles(node, childDef.styles);
      }
    }
  }

  // Add properties (no VARIANT props for single components)
  if (json.properties) {
    addNonVariantProperties(comp, json.properties);
  }

  return comp;
}

async function buildComponentSet(json: ComponentDescriptor): Promise<ComponentSetNode> {
  // Create a temporary frame to hold variant components before combining
  const tempFrame = figma.createFrame();
  tempFrame.name = "__temp_variant_holder__";
  figma.currentPage.appendChild(tempFrame);

  const variantComponents: ComponentNode[] = [];

  // 1. Build the base variant (no overrides)
  const baseComp = await buildVariantComponent(json, null, tempFrame);
  variantComponents.push(baseComp);

  // 2. Build each variant override
  if (json.variants) {
    for (const variantOverride of json.variants) {
      const varComp = await buildVariantComponent(json, variantOverride, tempFrame);
      variantComponents.push(varComp);
    }
  }

  // 3. Combine as variants
  const componentSet = figma.combineAsVariants(variantComponents, figma.currentPage);
  componentSet.name = json.name;

  if (json.description) {
    componentSet.description = json.description;
  }

  // 4. Add non-variant properties to the component set
  if (json.properties) {
    addNonVariantProperties(componentSet, json.properties);
  }

  // 5. Clean up temp frame if it's still around (combineAsVariants moves children out)
  if (tempFrame.parent) {
    tempFrame.remove();
  }

  return componentSet;
}

// ---------------------------------------------------------------------------
// Update existing node (upsert)
// ---------------------------------------------------------------------------

async function updateExistingNode(
  existing: SceneNode,
  json: ComponentDescriptor,
): Promise<string> {
  // Remember position
  const x = existing.x;
  const y = existing.y;
  const parentNode = existing.parent;

  // Remove old node
  existing.remove();

  // Rebuild
  let newNode: SceneNode;
  if (hasVariantProperties(json)) {
    newNode = await buildComponentSet(json);
  } else {
    newNode = await buildSingleComponent(json);
  }

  // Restore position
  newNode.x = x;
  newNode.y = y;

  // If the old node had a different parent (e.g. a specific page), reparent
  if (parentNode && "appendChild" in parentNode && parentNode !== newNode.parent) {
    (parentNode as ChildrenMixin).appendChild(newNode);
    newNode.x = x;
    newNode.y = y;
  }

  return newNode.id;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function applyComponentJSON(
  nodeId: string,
  json: ComponentDescriptor,
): Promise<string> {
  // 1. Try to find existing node
  const existing = await figma.getNodeByIdAsync(nodeId);

  if (existing && existing.type !== "DOCUMENT" && existing.type !== "PAGE") {
    return await updateExistingNode(existing as SceneNode, json);
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

  return newNode.id;
}
