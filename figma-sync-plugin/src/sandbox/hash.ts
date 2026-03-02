// djb2 hash — lightweight, no crypto API needed in sandbox
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

interface VisualProps {
  type: string;
  width: number;
  height: number;
  fills?: readonly Paint[] | typeof figma.mixed;
  strokes?: readonly Paint[];
  cornerRadius?: number | typeof figma.mixed;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  itemSpacing?: number;
  children?: VisualProps[];
}

function extractVisualProps(node: SceneNode): VisualProps {
  const props: VisualProps = {
    type: node.type,
    width: Math.round(node.width),
    height: Math.round(node.height),
  };

  if ("fills" in node) props.fills = node.fills;
  if ("strokes" in node) props.strokes = node.strokes;
  if ("cornerRadius" in node) props.cornerRadius = node.cornerRadius;

  if ("paddingTop" in node) {
    props.paddingTop = node.paddingTop;
    props.paddingRight = node.paddingRight;
    props.paddingBottom = node.paddingBottom;
    props.paddingLeft = node.paddingLeft;
  }

  if ("layoutMode" in node) {
    props.layoutMode = node.layoutMode;
    props.itemSpacing = node.itemSpacing;
  }

  if ("children" in node) {
    props.children = (node.children as SceneNode[]).map(extractVisualProps);
  }

  return props;
}

function replaceMixed(_key: string, value: unknown): unknown {
  if (value === figma.mixed) return "MIXED";
  return value;
}

export function computeFigmaHash(node: SceneNode): string {
  const props = extractVisualProps(node);
  return djb2(JSON.stringify(props, replaceMixed));
}

import type { FlatSnapshot } from "../shared/types";

export function extractFlatSnapshot(node: SceneNode): FlatSnapshot {
  const snapshot: FlatSnapshot = {
    type: node.type,
    width: Math.round(node.width),
    height: Math.round(node.height),
    fills: "",
    strokes: "",
    cornerRadius: "",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    layoutMode: "NONE",
    itemSpacing: 0,
    childCount: 0,
  };

  if ("fills" in node) {
    snapshot.fills = JSON.stringify(node.fills, replaceMixed);
  }
  if ("strokes" in node) {
    snapshot.strokes = JSON.stringify(node.strokes, replaceMixed);
  }
  if ("cornerRadius" in node) {
    snapshot.cornerRadius = JSON.stringify(node.cornerRadius, replaceMixed);
  }
  if ("paddingTop" in node) {
    snapshot.paddingTop = node.paddingTop;
    snapshot.paddingRight = node.paddingRight;
    snapshot.paddingBottom = node.paddingBottom;
    snapshot.paddingLeft = node.paddingLeft;
  }
  if ("layoutMode" in node) {
    snapshot.layoutMode = node.layoutMode;
    snapshot.itemSpacing = node.itemSpacing;
  }
  if ("children" in node) {
    snapshot.childCount = (node.children as SceneNode[]).length;
  }

  return snapshot;
}

// --- Token hashing (Variables & Styles) ---

export interface RawVariableData {
  id: string;
  name: string;
  resolvedType: string;
  collectionName: string;
  valuesByMode: Record<string, unknown>;
  codeSyntax?: string;
}

export interface RawStyleData {
  id: string;
  name: string;
  styleType: string;
  paints?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  effects?: string;
}

export function computeVariablesHash(variables: RawVariableData[]): string {
  const sorted = [...variables].sort((a, b) => a.name.localeCompare(b.name));
  const serialized = sorted.map(
    (v) => `${v.name}:${v.resolvedType}:${JSON.stringify(v.valuesByMode)}`
  ).join("|");
  return djb2(serialized);
}

export function computeStylesHash(styles: RawStyleData[]): string {
  const sorted = [...styles].sort((a, b) => a.name.localeCompare(b.name));
  const serialized = sorted.map((s) => {
    const props = [s.name, s.styleType, s.paints, s.fontSize, s.fontFamily, s.fontWeight, s.lineHeight, s.letterSpacing, s.effects]
      .map(v => v ?? "")
      .join(":");
    return props;
  }).join("|");
  return djb2(serialized);
}
