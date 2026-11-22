import { useState } from "react";

interface SheetPickerProps {
  fileName: string;
  sheetNames: string[];
  onSelect: (sheetName: string) => void;
  onCancel: () => void;
}

export const SheetPicker = ({
  fileName,
  sheetNames,
  onSelect,
  onCancel,
}: SheetPickerProps) => {
  const [selected, setSelected] = useState(sheetNames[0] ?? "");

  return (
    <div className="sheet-picker">
      <p className="sheet-picker-label">
        <strong>{fileName}</strong> has {sheetNames.length} sheet
        {sheetNames.length !== 1 && "s"}. Choose one to import:
      </p>
      <div className="sheet-picker-controls">
        <select
          className="sheet-picker-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          {sheetNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          className="sheet-picker-btn"
          onClick={() => onSelect(selected)}
        >
          Import sheet
        </button>
        <button
          className="sheet-picker-btn sheet-picker-btn-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
