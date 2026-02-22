# Dimension Selection and Ordering

## Goals

- Quick checkbox selection so you can focus on only the columns you care about.
- Sample values shown next to each dimension so you can tell if a column is useful before running the Sankey.
- Selected dimensions displayed in a table for a clear overview of your stage configuration.
- Drag-to-reorder in that table so you control stage order without guessing.
- Dimension UI logic lives in a dedicated `DimensionManager` component to keep `App.tsx` lean.
