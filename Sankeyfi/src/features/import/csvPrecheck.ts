const CSV_SAMPLE_BYTES = 512 * 1024;
const CSV_SAMPLE_LINES = 200;
const DEFAULT_DELIMITERS = [",", "\t", ";", "|"] as const;

type PrecheckSeverity = "info" | "warning" | "error";

export interface CsvPrecheckIssue {
  severity: PrecheckSeverity;
  message: string;
}

export interface CsvPrecheckResult {
  checked: boolean;
  canImport: boolean;
  delimiter: string;
  sampledRows: number;
  issues: CsvPrecheckIssue[];
  summary: string;
}

interface ParsedLine {
  values: string[];
  unclosedQuote: boolean;
}

const parseCsvLine = (line: string, delimiter: string): ParsedLine => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return { values, unclosedQuote: inQuotes };
};

const guessDelimiter = (lines: string[], extension: string): string => {
  if (extension === "tsv") {
    return "\t";
  }

  const candidates = [...DEFAULT_DELIMITERS];
  let bestDelimiter = ",";
  let bestScore = -Infinity;

  for (const delimiter of candidates) {
    let nonSingleColumnRows = 0;
    let consistentRows = 0;
    let previousCount = -1;

    for (const line of lines) {
      const fieldCount = parseCsvLine(line, delimiter).values.length;
      if (fieldCount > 1) {
        nonSingleColumnRows += 1;
      }
      if (previousCount > 0 && fieldCount === previousCount) {
        consistentRows += 1;
      }
      previousCount = fieldCount;
    }

    const score = nonSingleColumnRows * 5 + consistentRows;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
};

const formatDelimiterName = (delimiter: string): string => {
  if (delimiter === "\t") return "tab";
  if (delimiter === ",") return "comma";
  if (delimiter === ";") return "semicolon";
  if (delimiter === "|") return "pipe";
  return delimiter;
};

export const isDelimitedTextFile = (fileName: string): boolean => {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return extension === "csv" || extension === "tsv" || extension === "txt";
};

export const runCsvPrecheck = async (file: File): Promise<CsvPrecheckResult | null> => {
  if (!isDelimitedTextFile(file.name)) {
    return null;
  }

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const sampleText = await file.slice(0, CSV_SAMPLE_BYTES).text();
  const normalized = sampleText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, CSV_SAMPLE_LINES);

  const issues: CsvPrecheckIssue[] = [];

  if (!lines.length) {
    return {
      checked: true,
      canImport: false,
      delimiter: extension === "tsv" ? "\t" : ",",
      sampledRows: 0,
      issues: [{ severity: "error", message: "File appears empty in the sampled range." }],
      summary: "Pre-check failed: file is empty.",
    };
  }

  const delimiter = guessDelimiter(lines, extension);
  const parsedLines = lines.map((line) => parseCsvLine(line, delimiter));

  const quoteErrorLine = parsedLines.findIndex((line) => line.unclosedQuote);
  if (quoteErrorLine >= 0) {
    issues.push({
      severity: "error",
      message: `Unclosed quoted value detected near sampled row ${quoteErrorLine + 1}.`,
    });
  }

  const header = parsedLines[0].values.map((value) => value.trim());
  if (!header.length) {
    issues.push({ severity: "error", message: "Header row could not be parsed." });
  }

  const blankHeaderCount = header.filter((value) => value.length === 0).length;
  if (blankHeaderCount > 0) {
    issues.push({
      severity: "warning",
      message: `${blankHeaderCount} blank column name(s) found in header.`,
    });
  }

  const uniqueHeaderCount = new Set(header).size;
  if (uniqueHeaderCount !== header.length) {
    issues.push({ severity: "warning", message: "Duplicate column names detected in header." });
  }

  let mismatchCount = 0;
  for (let i = 1; i < parsedLines.length; i += 1) {
    if (parsedLines[i].values.length !== header.length) {
      mismatchCount += 1;
    }
  }

  if (mismatchCount > 0) {
    issues.push({
      severity: mismatchCount > 5 ? "error" : "warning",
      message: `${mismatchCount} sampled row(s) have a different column count than the header (${header.length}).`,
    });
  }

  if (!issues.length) {
    issues.push({
      severity: "info",
      message: `Sample looks consistent (${lines.length} rows checked, ${header.length} columns).`,
    });
  }

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasWarning = issues.some((issue) => issue.severity === "warning");
  const health = hasError ? "failed" : hasWarning ? "passed with warnings" : "passed";

  return {
    checked: true,
    canImport: !hasError,
    delimiter,
    sampledRows: lines.length,
    issues,
    summary: `Pre-check ${health} (${formatDelimiterName(delimiter)} delimiter guess).`,
  };
};
