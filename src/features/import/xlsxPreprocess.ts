import { read, utils, type WorkBook } from "xlsx";

export interface XlsxParseResult {
  workbook: WorkBook;
  sheetNames: string[];
}

export const parseXlsxFile = async (file: File): Promise<XlsxParseResult> => {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: "array" });
  return { workbook, sheetNames: workbook.SheetNames };
};

export const sheetToCsvBytes = (
  workbook: WorkBook,
  sheetName: string,
): Uint8Array => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook.`);
  }
  const csv = utils.sheet_to_csv(sheet);
  return new TextEncoder().encode(csv);
};

export const isExcelFile = (fileName: string): boolean => {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ext === "xlsx" || ext === "xls";
};
