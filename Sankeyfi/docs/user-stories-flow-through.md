## User Stories

- As a user, I want to click on a node bar (rectangle) in the Sankey diagram and get the same interaction as clicking its label, so I can intuitively explore flows without having to target the small text.
- As a user, when I click a node at the beginning or end of the diagram, I want to see the proportional flow from/to that node highlighted through all intermediate nodes, so I can trace how data fans out or converges across stages.
- As a user, I want the flow-through highlight to use the same color as the clicked node, so the traced path is visually associated with its origin.
- As a user, I want the flow-through paths to connect at the same vertical position on each intermediate node (entry aligns with exit), so the traced flow reads as a continuous ribbon rather than disconnected segments.
- As a user, I want all non-traced links to fade when a flow-through is active, so the traced path stands out clearly against the rest of the diagram.
- As a user, when I apply a record-level overlay from the drill-down panel, I want the overlay lines to have proportional stroke width based on each record's value relative to the link total, so I can visually compare individual record magnitudes.

## Feature Summary

### Flow-Through Visualization

Clicking a node in the first or last column of the Sankey diagram activates flow-through mode:

1. A flow propagation algorithm computes how much of each link's value is attributable to the clicked node, distributing proportions layer by layer through the graph.
2. A vertically-centered "band" is computed on each intermediate node, sized proportionally to the attributed flow.
3. Custom bezier paths connect the bands so that each segment's exit point on one node aligns with its entry point on the next, creating a continuous ribbon.
4. The ribbon uses the clicked node's category color and all other links fade to low opacity.
5. Hovering any segment shows a tooltip with the attributed flow value and the link's total value.

Clicking the same node again, clicking the background, or clicking outside the chart deselects and restores the default view.

### Record-Level Overlay

From the Trace Drill-Down panel, users can overlay individual record paths on the chart. Overlay lines use proportional stroke widths so records contributing more flow appear as thicker lines.
