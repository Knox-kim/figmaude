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
