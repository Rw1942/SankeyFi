import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sankey as createSankey, sankeyLinkHorizontal } from "d3-sankey";
import { DEFAULT_SANKEY_RENDER_OPTIONS } from "../types";
import type {
  AmountDataType,
  SankeyGraph,
  SankeyLink,
  SankeyNode,
  SankeyRenderOptions,
  TraceOverlaySegment,
  TracePathSegment,
  TraceSelection,
  ValueMode,
} from "../types";
import { formatFlowValue } from "../valueFormatting";

interface SankeyChartProps {
  graph: SankeyGraph | null;
  columnHeaders?: string[];
  renderOptions?: SankeyRenderOptions;
  valueMode: ValueMode;
  amountDataType: AmountDataType;
  highlightedPathSegments?: TracePathSegment[] | null;
  overlaySegments?: TraceOverlaySegment[];
  onTraceSelectionChange?: (selection: TraceSelection | null) => void;
}

type RenderNode = SankeyNode & {
  layer?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
};

type RenderLink = SankeyLink & {
  source: RenderNode;
  target: RenderNode;
  width?: number;
  y0?: number;
  y1?: number;
};
type SelectionFocus = { kind: "link"; key: string } | { kind: "node"; nodeId: string };

const CATEGORY_COLORS = ["#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#f59e0b", "#f97316", "#ec4899", "#7c3aed"];
const OTHER_COLOR = "#94a3b8";
const MIN_CHART_WIDTH = 320;
const MIN_CHART_HEIGHT = 260;
const MAX_CHART_HEIGHT = 980;
const CHART_PADDING = 16;
const MIN_LABEL_GUTTER = 66;
const MAX_LABEL_GUTTER = 132;
const EDGE_GUTTER_FACTOR = 0.4;
const LABEL_OFFSET = 8;
const MAX_LABEL_CHARS = 26;
const HEADER_BAND_HEIGHT = 26;
const HEADER_TEXT_OFFSET_Y = 4;
const HEADER_TO_CHART_GAP = 10;
const MIN_WRAP_LINE_CHARS = 10;
const MAX_WRAP_LINE_CHARS = 32;
const MIN_NODE_WIDTH = 6;
const MAX_NODE_WIDTH = 40;
const MIN_NODE_PADDING = 4;
const MAX_NODE_PADDING = 44;
const MIN_HEIGHT_RATIO = 0.35;
const MAX_HEIGHT_RATIO = 0.9;
const MIN_LABEL_GUTTER_RATIO = 0.08;
const MAX_LABEL_GUTTER_RATIO = 0.22;
const MIN_LINK_OPACITY = 0.08;
const MAX_LINK_OPACITY = 1;
const MIN_LABEL_FONT_SIZE = 9;
const MAX_LABEL_FONT_SIZE = 18;
const FADED_LINK_OPACITY_FLOOR = 0.08;
const FADED_NODE_OPACITY = 0.3;
const ACTIVE_NODE_OPACITY = 0.9;
const ACTIVE_LINK_STROKE_WIDTH_MULTIPLIER = 1.15;
const OVERLAY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const truncateLabel = (label: string): string => (label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const wrapLabel = (label: string, maxCharsPerLine: number): string[] => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [label];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxCharsPerLine) {
        lines.push(word.slice(i, i + maxCharsPerLine));
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [label];
};

export const SankeyChart = ({
  graph,
  columnHeaders = [],
  renderOptions,
  valueMode,
  amountDataType,
  highlightedPathSegments,
  overlaySegments = [],
  onTraceSelectionChange,
}: SankeyChartProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectionFocus, setSelectionFocus] = useState<SelectionFocus | null>(null);

  useEffect(() => {
    if (!selectionFocus) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setSelectionFocus(null);
      onTraceSelectionChange?.(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [selectionFocus, onTraceSelectionChange]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(Math.max(MIN_CHART_WIDTH, Math.floor(container.getBoundingClientRect().width)));
    };

    updateWidth();
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setContainerWidth(Math.max(MIN_CHART_WIDTH, Math.floor(entry.contentRect.width)));
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const chartWidth = Math.max(MIN_CHART_WIDTH, containerWidth);
  const options = {
    ...DEFAULT_SANKEY_RENDER_OPTIONS,
    ...renderOptions,
  };
  const chartHeightRatio = clamp(options.chartHeightRatio, MIN_HEIGHT_RATIO, MAX_HEIGHT_RATIO);
  const labelGutterRatio = clamp(options.labelGutterRatio, MIN_LABEL_GUTTER_RATIO, MAX_LABEL_GUTTER_RATIO);
  const chartHeight = Math.max(MIN_CHART_HEIGHT, Math.min(MAX_CHART_HEIGHT, Math.round(chartWidth * chartHeightRatio)));
  const labelGutter = Math.max(MIN_LABEL_GUTTER, Math.min(MAX_LABEL_GUTTER, Math.round(chartWidth * labelGutterRatio)));
  const edgeGutter = Math.round(labelGutter * EDGE_GUTTER_FACTOR);
  const nodeWidthOption = clamp(options.nodeWidth, MIN_NODE_WIDTH, MAX_NODE_WIDTH);
  const nodePaddingOption = clamp(options.nodePadding, MIN_NODE_PADDING, MAX_NODE_PADDING);
  const linkOpacityOption = clamp(options.linkOpacity, MIN_LINK_OPACITY, MAX_LINK_OPACITY);
  const labelFontSizeOption = clamp(options.labelFontSize, MIN_LABEL_FONT_SIZE, MAX_LABEL_FONT_SIZE);

  const hasGraph = !!graph?.links.length;
  const halfWidth = chartWidth / 2;
  const categoryColorByLabel = new Map<string, string>();
  if (graph?.nodes.length) {
    const labels = [...new Set(graph.nodes.map((node) => node.label))].sort((left, right) => left.localeCompare(right));
    labels.forEach((label, index) => {
      categoryColorByLabel.set(label, label === "Other" ? OTHER_COLOR : CATEGORY_COLORS[index % CATEGORY_COLORS.length]);
    });
  }
  const longestLabelLength = graph?.nodes.length ? Math.max(...graph.nodes.map((node) => node.label.length), 1) : 1;
  const maxWrappedChars = Math.min(MAX_WRAP_LINE_CHARS, Math.max(MIN_WRAP_LINE_CHARS, Math.floor(longestLabelLength * 0.5)));

  let layout: { nodes: RenderNode[]; links: RenderLink[] } | null = null;
  let linkPath: ReturnType<typeof sankeyLinkHorizontal<RenderNode, RenderLink>> | null = null;
  if (hasGraph) {
    const sankey = createSankey<SankeyNode, SankeyLink>()
      .nodeId((node) => node.id)
      .nodeWidth(nodeWidthOption)
      .nodePadding(nodePaddingOption)
      .nodeSort(null)
      .extent([
        [CHART_PADDING + edgeGutter, CHART_PADDING + HEADER_BAND_HEIGHT + HEADER_TO_CHART_GAP],
        [chartWidth - CHART_PADDING - edgeGutter, chartHeight - CHART_PADDING],
      ]);

    // Clone graph arrays so d3-sankey can mutate coordinates safely.
    layout = sankey({
      nodes: graph.nodes.map((node) => ({ ...node })),
      links: graph.links.map((link) => ({ ...link })),
    }) as { nodes: RenderNode[]; links: RenderLink[] };
    linkPath = sankeyLinkHorizontal<RenderNode, RenderLink>();
  }
  const headerByLayer = new Map<number, { x: number; text: string }>();
  if (layout && columnHeaders.length) {
    for (const node of layout.nodes) {
      const layer = node.layer ?? node.depth;
      if (!Number.isFinite(layer) || headerByLayer.has(layer)) continue;
      const x0 = node.x0 ?? 0;
      const x1 = node.x1 ?? x0;
      headerByLayer.set(layer, { x: x0 + (x1 - x0) / 2, text: columnHeaders[layer] ?? "" });
    }
  }
  const buildLinkKey = (link: RenderLink, index: number) => `${link.source.id}-${link.target.id}-${index}`;
  const layoutLinkByPair = new Map<string, RenderLink>();
  if (layout) {
    for (const link of layout.links) {
      const pairKey = `${link.source.id}\u0000${link.target.id}`;
      if (!layoutLinkByPair.has(pairKey)) layoutLinkByPair.set(pairKey, link);
    }
  }
  let activePathLinkKeys: Set<string> | null = null;
  let selectedNodeIds: Set<string> | null = null;
  const explicitPathKeySet = highlightedPathSegments?.length
    ? new Set(highlightedPathSegments.map((segment) => `${segment.sourceId}\u0000${segment.targetId}`))
    : null;
  if (explicitPathKeySet?.size) {
    activePathLinkKeys = explicitPathKeySet;
    selectedNodeIds = new Set(highlightedPathSegments!.flatMap((segment) => [segment.sourceId, segment.targetId]));
  } else if (selectionFocus && layout) {
    const incomingByTarget = new Map<string, Array<{ key: string; sourceId: string }>>();
    const outgoingBySource = new Map<string, Array<{ key: string; targetId: string }>>();
    const linkByKey = new Map<string, RenderLink>();

    layout.links.forEach((link, index) => {
      const key = buildLinkKey(link, index);
      const sourceId = link.source.id;
      const targetId = link.target.id;
      linkByKey.set(key, link);
      const incoming = incomingByTarget.get(targetId);
      if (incoming) {
        incoming.push({ key, sourceId });
      } else {
        incomingByTarget.set(targetId, [{ key, sourceId }]);
      }
      const outgoing = outgoingBySource.get(sourceId);
      if (outgoing) {
        outgoing.push({ key, targetId });
      } else {
        outgoingBySource.set(sourceId, [{ key, targetId }]);
      }
    });

    const upstreamSeedIds = new Set<string>();
    const downstreamSeedIds = new Set<string>();
    if (selectionFocus.kind === "link") {
      const selectedLink = linkByKey.get(selectionFocus.key);
      if (selectedLink) {
        upstreamSeedIds.add(selectedLink.source.id);
        downstreamSeedIds.add(selectedLink.target.id);
      }
    } else {
      upstreamSeedIds.add(selectionFocus.nodeId);
      downstreamSeedIds.add(selectionFocus.nodeId);
    }

    if (!upstreamSeedIds.size || !downstreamSeedIds.size) {
      activePathLinkKeys = null;
      selectedNodeIds = null;
    } else {
      const upstreamLinkKeys = new Set<string>();
      const upstreamNodeIds = new Set<string>(upstreamSeedIds);
      const upstreamQueue = [...upstreamSeedIds];
      while (upstreamQueue.length) {
        const nodeId = upstreamQueue.shift();
        if (!nodeId) continue;
        const incomingLinks = incomingByTarget.get(nodeId) ?? [];
        for (const incoming of incomingLinks) {
          if (!upstreamLinkKeys.has(incoming.key)) upstreamLinkKeys.add(incoming.key);
          if (!upstreamNodeIds.has(incoming.sourceId)) {
            upstreamNodeIds.add(incoming.sourceId);
            upstreamQueue.push(incoming.sourceId);
          }
        }
      }

      const downstreamLinkKeys = new Set<string>();
      const downstreamNodeIds = new Set<string>(downstreamSeedIds);
      const downstreamQueue = [...downstreamSeedIds];
      while (downstreamQueue.length) {
        const nodeId = downstreamQueue.shift();
        if (!nodeId) continue;
        const outgoingLinks = outgoingBySource.get(nodeId) ?? [];
        for (const outgoing of outgoingLinks) {
          if (!downstreamLinkKeys.has(outgoing.key)) downstreamLinkKeys.add(outgoing.key);
          if (!downstreamNodeIds.has(outgoing.targetId)) {
            downstreamNodeIds.add(outgoing.targetId);
            downstreamQueue.push(outgoing.targetId);
          }
        }
      }

      activePathLinkKeys = new Set([...upstreamLinkKeys, ...downstreamLinkKeys]);
      if (selectionFocus.kind === "link") {
        activePathLinkKeys.add(selectionFocus.key);
      }
      selectedNodeIds = new Set([...upstreamNodeIds, ...downstreamNodeIds]);
    }
  }

  let flowThroughActive = false;
  let flowThroughColor: string | null = null;
  const flowThroughPaths: Array<{ d: string; strokeWidth: number; flowValue: number; linkValue: number }> = [];

  if (selectionFocus?.kind === "node" && layout && !explicitPathKeySet) {
    const clickedNode = layout.nodes.find((n) => n.id === selectionFocus.nodeId);
    if (clickedNode) {
      const maxLayer = Math.max(0, ...layout.nodes.map((n) => n.layer ?? 0));
      const nodeLayer = clickedNode.layer ?? 0;
      const isFirstColumn = nodeLayer === 0;
      const isLastColumn = nodeLayer === maxLayer;

      if (isFirstColumn || isLastColumn) {
        flowThroughColor = categoryColorByLabel.get(clickedNode.label) ?? CATEGORY_COLORS[0];
        const flowByLink = new Map<string, number>();

        const incomingByNode = new Map<string, RenderLink[]>();
        const outgoingByNode = new Map<string, RenderLink[]>();
        const totalIncoming = new Map<string, number>();
        const totalOutgoing = new Map<string, number>();
        for (const link of layout.links) {
          const outList = outgoingByNode.get(link.source.id) ?? [];
          outList.push(link);
          outgoingByNode.set(link.source.id, outList);
          const inList = incomingByNode.get(link.target.id) ?? [];
          inList.push(link);
          incomingByNode.set(link.target.id, inList);
          totalOutgoing.set(link.source.id, (totalOutgoing.get(link.source.id) ?? 0) + link.value);
          totalIncoming.set(link.target.id, (totalIncoming.get(link.target.id) ?? 0) + link.value);
        }

        const attribution = new Map<string, number>();
        attribution.set(selectionFocus.nodeId, 1.0);

        const nodesByLayer = new Map<number, RenderNode[]>();
        for (const node of layout.nodes) {
          const layer = node.layer ?? 0;
          const list = nodesByLayer.get(layer) ?? [];
          list.push(node);
          nodesByLayer.set(layer, list);
        }

        if (isFirstColumn) {
          const layers = [...nodesByLayer.keys()].sort((a, b) => a - b);
          for (const layer of layers) {
            for (const node of nodesByLayer.get(layer) ?? []) {
              if (node.id === selectionFocus.nodeId) continue;
              const incoming = incomingByNode.get(node.id) ?? [];
              const totalIn = totalIncoming.get(node.id) ?? 0;
              if (totalIn <= 0) continue;
              let attributed = 0;
              for (const link of incoming) {
                attributed += link.value * (attribution.get(link.source.id) ?? 0);
              }
              attribution.set(node.id, attributed / totalIn);
            }
          }
          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            const flow = link.value * (attribution.get(link.source.id) ?? 0);
            if (flow > 0) flowByLink.set(pairKey, flow);
          }
        } else {
          const layers = [...nodesByLayer.keys()].sort((a, b) => b - a);
          for (const layer of layers) {
            for (const node of nodesByLayer.get(layer) ?? []) {
              if (node.id === selectionFocus.nodeId) continue;
              const outgoing = outgoingByNode.get(node.id) ?? [];
              const totalOut = totalOutgoing.get(node.id) ?? 0;
              if (totalOut <= 0) continue;
              let attributed = 0;
              for (const link of outgoing) {
                attributed += link.value * (attribution.get(link.target.id) ?? 0);
              }
              attribution.set(node.id, attributed / totalOut);
            }
          }
          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            const flow = link.value * (attribution.get(link.target.id) ?? 0);
            if (flow > 0) flowByLink.set(pairKey, flow);
          }
        }

        if (flowByLink.size > 0) {
          flowThroughActive = true;

          const nodeFlowOut = new Map<string, number>();
          const nodeFlowIn = new Map<string, number>();
          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            const flow = flowByLink.get(pairKey) ?? 0;
            if (flow > 0) {
              nodeFlowOut.set(link.source.id, (nodeFlowOut.get(link.source.id) ?? 0) + flow);
              nodeFlowIn.set(link.target.id, (nodeFlowIn.get(link.target.id) ?? 0) + flow);
            }
          }

          const nodeBands = new Map<string, { bandY: number; bandHeight: number }>();
          for (const node of layout.nodes) {
            const ny0 = node.y0 ?? 0;
            const ny1 = node.y1 ?? 0;
            const nh = ny1 - ny0;
            const flowTotal = Math.max(nodeFlowOut.get(node.id) ?? 0, nodeFlowIn.get(node.id) ?? 0);
            if (flowTotal <= 0 || nh <= 0) continue;
            const nodeTotal = Math.max(totalOutgoing.get(node.id) ?? 0, totalIncoming.get(node.id) ?? 0);
            if (nodeTotal <= 0) continue;
            const bandHeight = (flowTotal / nodeTotal) * nh;
            const bandY = ny0 + (nh - bandHeight) / 2;
            nodeBands.set(node.id, { bandY, bandHeight });
          }

          const sourceSlots = new Map<string, { y: number; h: number }>();
          const flowLinksBySource = new Map<string, RenderLink[]>();
          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            if ((flowByLink.get(pairKey) ?? 0) > 0) {
              const list = flowLinksBySource.get(link.source.id) ?? [];
              list.push(link);
              flowLinksBySource.set(link.source.id, list);
            }
          }
          for (const [nodeId, links] of flowLinksBySource) {
            const band = nodeBands.get(nodeId);
            if (!band) continue;
            const flowTotal = nodeFlowOut.get(nodeId) ?? 1;
            links.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
            let offset = 0;
            for (const link of links) {
              const pairKey = `${link.source.id}\u0000${link.target.id}`;
              const flow = flowByLink.get(pairKey)!;
              const sliceH = (flow / flowTotal) * band.bandHeight;
              sourceSlots.set(pairKey, { y: band.bandY + offset + sliceH / 2, h: sliceH });
              offset += sliceH;
            }
          }

          const targetSlots = new Map<string, { y: number; h: number }>();
          const flowLinksByTarget = new Map<string, RenderLink[]>();
          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            if ((flowByLink.get(pairKey) ?? 0) > 0) {
              const list = flowLinksByTarget.get(link.target.id) ?? [];
              list.push(link);
              flowLinksByTarget.set(link.target.id, list);
            }
          }
          for (const [nodeId, links] of flowLinksByTarget) {
            const band = nodeBands.get(nodeId);
            if (!band) continue;
            const flowTotal = nodeFlowIn.get(nodeId) ?? 1;
            links.sort((a, b) => (a.y1 ?? 0) - (b.y1 ?? 0));
            let offset = 0;
            for (const link of links) {
              const pairKey = `${link.source.id}\u0000${link.target.id}`;
              const flow = flowByLink.get(pairKey)!;
              const sliceH = (flow / flowTotal) * band.bandHeight;
              targetSlots.set(pairKey, { y: band.bandY + offset + sliceH / 2, h: sliceH });
              offset += sliceH;
            }
          }

          for (const link of layout.links) {
            const pairKey = `${link.source.id}\u0000${link.target.id}`;
            const flow = flowByLink.get(pairKey);
            if (!flow || flow <= 0) continue;
            const src = sourceSlots.get(pairKey);
            const tgt = targetSlots.get(pairKey);
            if (!src || !tgt) continue;
            const x0 = link.source.x1 ?? 0;
            const x1 = link.target.x0 ?? 0;
            const dx = x1 - x0;
            const sw = Math.max(1.5, Math.min(src.h, tgt.h));
            const d = `M${x0},${src.y}C${x0 + dx / 2},${src.y},${x1 - dx / 2},${tgt.y},${x1},${tgt.y}`;
            flowThroughPaths.push({ d, strokeWidth: sw, flowValue: flow, linkValue: link.value });
          }
        }
      }
    }
  }

  return (
    <div className="sankey-wrap" ref={containerRef}>
      {layout && linkPath ? (
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="sankey-svg"
          role="img"
          aria-label="Sankey diagram"
          onClick={() => {
            setSelectionFocus(null);
            onTraceSelectionChange?.(null);
          }}
        >
          <g>
            <rect
              className="sankey-header-band"
              x={CHART_PADDING}
              y={CHART_PADDING}
              width={chartWidth - CHART_PADDING * 2}
              height={HEADER_BAND_HEIGHT}
              rx={6}
              ry={6}
            />
            <line
              className="sankey-header-divider"
              x1={CHART_PADDING}
              y1={CHART_PADDING + HEADER_BAND_HEIGHT}
              x2={chartWidth - CHART_PADDING}
              y2={CHART_PADDING + HEADER_BAND_HEIGHT}
            />
            {[...headerByLayer.entries()]
              .sort((left, right) => left[0] - right[0])
              .map(([layer, header]) =>
                header.text ? (
                  <text
                    key={`column-header-${layer}`}
                    className="sankey-column-header"
                    x={header.x}
                    y={CHART_PADDING + HEADER_BAND_HEIGHT / 2 + HEADER_TEXT_OFFSET_Y}
                    textAnchor="middle"
                  >
                    {truncateLabel(header.text)}
                  </text>
                ) : null,
              )}
          </g>
          <g fill="none">
            {layout.links.map((link, index) => {
              const linkKey = buildLinkKey(link, index);
              const explicitPairKey = `${link.source.id}\u0000${link.target.id}`;
              const isSelected = explicitPathKeySet ? explicitPathKeySet.has(explicitPairKey) : !!activePathLinkKeys?.has(linkKey);
              const hasSelection = !!selectionFocus || !!explicitPathKeySet;
              const hasFlowThrough = flowThroughActive;
              const computedOpacity = hasSelection
                ? hasFlowThrough
                  ? Math.max(FADED_LINK_OPACITY_FLOOR, linkOpacityOption * 0.28)
                  : isSelected
                    ? Math.min(1, linkOpacityOption + 0.25)
                    : Math.max(FADED_LINK_OPACITY_FLOOR, linkOpacityOption * 0.28)
                : linkOpacityOption;
              const computedStrokeWidth =
                hasSelection && isSelected && !hasFlowThrough
                  ? Math.max(1, (link.width ?? 1) * ACTIVE_LINK_STROKE_WIDTH_MULTIPLIER)
                  : Math.max(1, link.width ?? 1);

              return (
                <path
                  key={linkKey}
                  d={linkPath(link) ?? ""}
                  stroke={categoryColorByLabel.get(link.source.label) ?? CATEGORY_COLORS[0]}
                  strokeWidth={computedStrokeWidth}
                  strokeOpacity={computedOpacity}
                  style={{ cursor: "pointer", transition: "stroke-opacity 150ms ease, stroke-width 150ms ease" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectionFocus((current) => {
                      const nextFocus = current?.kind === "link" && current.key === linkKey ? null : { kind: "link" as const, key: linkKey };
                      onTraceSelectionChange?.(
                        nextFocus
                          ? {
                              kind: "link",
                              step: link.step,
                              sourceId: link.source.id,
                              targetId: link.target.id,
                              sourceLabel: link.source.label,
                              targetLabel: link.target.label,
                              value: link.value,
                            }
                          : null,
                      );
                      return nextFocus;
                    });
                  }}
                >
                  <title>
                    {`${link.source.label} → ${link.target.label}: ${formatFlowValue(link.value, valueMode, amountDataType)}`}
                  </title>
                </path>
              );
            })}
          </g>

          {flowThroughPaths.length > 0 && flowThroughColor ? (
            <g fill="none" pointerEvents="none">
              {flowThroughPaths.map((seg, index) => (
                <path
                  key={`flowthrough-${index}`}
                  d={seg.d}
                  stroke={flowThroughColor}
                  strokeWidth={seg.strokeWidth}
                  strokeOpacity={0.85}
                  style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,0.5))" }}
                >
                  <title>
                    {`Flow through: ${formatFlowValue(seg.flowValue, valueMode, amountDataType)} of ${formatFlowValue(
                      seg.linkValue,
                      valueMode,
                      amountDataType,
                    )}`}
                  </title>
                </path>
              ))}
            </g>
          ) : null}

          {overlaySegments.length ? (
            <g fill="none" pointerEvents="stroke">
              {overlaySegments.map((segment, index) => {
                const pairKey = `${segment.sourceId}\u0000${segment.targetId}`;
                const overlayLink = layoutLinkByPair.get(pairKey);
                if (!overlayLink) return null;
                const linkTotalWidth = Math.max(1, overlayLink.width ?? 1);
                const linkTotalValue = overlayLink.value || 1;
                const proportionalWidth = clamp((segment.value / linkTotalValue) * linkTotalWidth, 1.5, linkTotalWidth);
                return (
                  <path
                    key={`overlay-${segment.recordId}-${segment.step}-${index}`}
                    d={linkPath(overlayLink) ?? ""}
                    stroke={OVERLAY_COLORS[segment.colorIndex % OVERLAY_COLORS.length]}
                    strokeWidth={proportionalWidth}
                    strokeOpacity={0.92}
                    style={{ filter: "drop-shadow(0 0 1px rgba(255,255,255,0.7))" }}
                  >
                    <title>
                      {`Record ${segment.recordId}\n${segment.sourceLabel} → ${segment.targetLabel}\nStep value: ${formatFlowValue(
                        segment.value,
                        valueMode,
                        amountDataType,
                      )}`}
                    </title>
                  </path>
                );
              })}
            </g>
          ) : null}

          <g>
            {layout.nodes.map((node) => {
              const x = node.x0 ?? 0;
              const y = node.y0 ?? 0;
              const nodeWidth = Math.max(1, (node.x1 ?? 0) - (node.x0 ?? 0));
              const nodeHeight = Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0));
              const labelOnRight = x < halfWidth;
              const textX = labelOnRight ? x + nodeWidth + LABEL_OFFSET : x - LABEL_OFFSET;
              const textAnchor = labelOnRight ? "start" : "end";
              const wrappedLabel = wrapLabel(node.label, maxWrappedChars);
              const nodeColor = categoryColorByLabel.get(node.label) ?? CATEGORY_COLORS[0];
              const hasSelection = !!selectedNodeIds || !!explicitPathKeySet;
              const isConnectedToSelection = !!selectedNodeIds?.has(node.id);
              const nodeOpacity = hasSelection ? (isConnectedToSelection ? ACTIVE_NODE_OPACITY : FADED_NODE_OPACITY) : 1;

              const handleNodeClick = (event: React.MouseEvent) => {
                event.stopPropagation();
                setSelectionFocus((current) => {
                  const nextFocus = current?.kind === "node" && current.nodeId === node.id ? null : { kind: "node" as const, nodeId: node.id };
                  onTraceSelectionChange?.(nextFocus ? { kind: "node", nodeId: node.id, depth: node.depth, label: node.label } : null);
                  return nextFocus;
                });
              };

              return (
                <g key={node.id}>
                  <rect
                    x={x}
                    y={y}
                    width={nodeWidth}
                    height={nodeHeight}
                    fill={nodeColor}
                    stroke="#ffffff"
                    strokeWidth={0.8}
                    rx={2}
                    ry={2}
                    fillOpacity={nodeOpacity}
                    style={{ cursor: "pointer", transition: "fill-opacity 150ms ease" }}
                    onClick={handleNodeClick}
                  >
                    <title>{node.label}</title>
                  </rect>
                  <text
                    className="sankey-label"
                    x={textX}
                    y={y + nodeHeight / 2}
                    textAnchor={textAnchor}
                    style={{ fontSize: `${labelFontSizeOption}px`, cursor: "pointer", transition: "fill-opacity 150ms ease" }}
                    fillOpacity={nodeOpacity}
                    onClick={handleNodeClick}
                  >
                    <title>{node.label}</title>
                    {wrappedLabel.map((line, lineIndex) => (
                      <tspan key={`${node.id}-${lineIndex}`} x={textX} dy={lineIndex === 0 ? `${-(wrappedLabel.length - 1) * 0.55}em` : "1.1em"}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      ) : (
        <div className="empty-state">Load data, choose at least 2 dimensions, and run a Sankey query.</div>
      )}
    </div>
  );
};
