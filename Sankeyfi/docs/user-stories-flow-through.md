# Flow-Through Visualization

## Goals

- Clicking a node bar or its label should behave the same way -- no need to target the tiny text.
- Clicking a node in the first or last column highlights proportional flow through all intermediate nodes.
- The highlight uses the clicked node's color so the traced path is visually tied to its origin.
- Flow-through paths connect at matching vertical positions on each intermediate node (entry aligns with exit), reading as a continuous ribbon.
- Non-traced links fade so the highlighted path stands out.
- Record-level overlay lines use proportional stroke widths so higher-value records appear thicker.

## How It Works

When you click a first- or last-column node:

1. A propagation algorithm computes how much of each link's value is attributable to the clicked node, distributing proportions layer by layer.
2. A vertically-centered band is sized on each intermediate node proportional to the attributed flow.
3. Custom bezier paths connect these bands so each segment's exit aligns with the next segment's entry -- creating one continuous ribbon.
4. The ribbon takes the clicked node's category color; everything else fades to low opacity.
5. Hovering any segment shows a tooltip with the attributed value and the link total.

Click the same node again, click the background, or click outside the chart to deselect.

## Record-Level Overlay

From the Trace Drill-Down panel you can overlay individual record paths on the chart. Stroke widths are proportional to each record's value relative to the link total, so you can visually compare record magnitudes at a glance.
