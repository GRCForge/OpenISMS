import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file';

type Row = Record<string, unknown>;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportToCSV = (data: Row[], filename: string) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(';') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [headers.join(';'), ...data.map(row => headers.map(h => escape(row[h])).join(';'))].join('\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
};

// Map an arbitrary value to a write-excel-file cell, preserving numeric/boolean
// types where possible and falling back to a string for everything else.
// Empty values become a null cell (an empty cell in the sheet).
const toCell = (v: unknown): Cell => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return { value: v, type: Number };
  if (typeof v === 'boolean') return { value: v, type: Boolean };
  if (v instanceof Date) return { value: v, type: Date, format: 'dd.mm.yyyy' };
  return { value: String(v), type: String };
};

const buildRows = (data: Row[]): SheetData => {
  const headers = Object.keys(data[0]);
  const headerRow: Cell[] = headers.map(h => ({ value: h, fontWeight: 'bold' }));
  const dataRows: Cell[][] = data.map(row => headers.map(h => toCell(row[h])));
  return [headerRow, ...dataRows];
};

const buildColumns = (data: Row[]) => {
  const headers = Object.keys(data[0]);
  return headers.map(key => ({
    width: Math.max(key.length, ...data.slice(0, 200).map(r => String(r[key] ?? '').length)) + 2,
  }));
};

export const exportToExcel = async (data: Row[], filename: string, sheetName = 'Export') => {
  if (!data.length) return;
  await writeXlsxFile(buildRows(data), {
    columns: buildColumns(data),
    sheet: sheetName.slice(0, 31),
    fileName: `${filename}.xlsx`,
  });
};

export const exportToMultiSheetExcel = async (
  sheets: { name: string; data: Row[] }[],
  filename: string,
) => {
  const filled = sheets.filter(s => s.data.length);
  if (!filled.length) return;
  await writeXlsxFile(
    filled.map(s => buildRows(s.data)),
    {
      columns: filled.map(s => buildColumns(s.data)),
      sheets: filled.map(s => s.name.slice(0, 31)),
      fileName: `${filename}.xlsx`,
    },
  );
};
