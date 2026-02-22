## User Stories

- As an analyst importing large CSV files, I want a fast pre-import quality check so I can catch likely formatting issues before waiting through a long import.
- As a user, I want import warnings/errors reported in the existing status area so I can understand what happened without searching elsewhere in the UI.
- As a user, I want safe files to continue importing automatically after the pre-check so I can keep my workflow fast.
- As a user, I want risky files (for example, malformed quoted values or severe column mismatches) blocked before import so I can fix the source file first.
- As a maintainer, I want pre-check logic split into a focused module so `App.tsx` stays easier to evolve as import capabilities grow.
