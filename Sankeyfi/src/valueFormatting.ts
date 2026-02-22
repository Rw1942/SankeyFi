import type { AmountDataType, ValueMode } from "./types";

const USD_MILLION_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatFlowValue = (value: number, mode: ValueMode, amountDataType: AmountDataType): string => {
  if (mode === "sum" && amountDataType === "usd_millions") {
    const roundedMillions = Math.round(value / 1_000_000);
    return `${USD_MILLION_FORMATTER.format(roundedMillions)}M`;
  }
  return value.toLocaleString();
};
