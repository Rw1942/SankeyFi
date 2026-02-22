# CSV Import Pre-Check

## Goals

- Run a fast quality check before importing large CSV files so formatting issues surface early.
- Report warnings and errors in the existing status area -- no hunting around the UI.
- Auto-continue importing when the file looks clean, keeping the workflow fast.
- Block risky files (e.g. malformed quoting, severe column mismatches) so you can fix the source before wasting time.
- Pre-check logic lives in `src/features/import/csvPrecheck.ts` to keep `App.tsx` focused.
