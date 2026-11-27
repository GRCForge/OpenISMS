import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/browser';
// Formel-Neutralisierung fuer CSV-Exporte (CWE-1236) — siehe lib/csv.ts.
import { neutralizeFormula } from './csv';
import api from './api';

export { neutralizeFormula, csvCell } from './csv';

type Row = Record<string, unknown>;

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// File name from a Content-Disposition header (RFC 6266: filename* wins).
const filenameFrom = (header: unknown, fallback: string) => {
  const h = typeof header === 'string' ? header : '';
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(h);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* fall through */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(h);
  return plain ? plain[1].trim() : fallback;
};

export type ReportFormat = 'docx' | 'pdf';

// Server-rendered reports (DOCX / PDF, 3.10.0). The server writes the audit
// entry and names the file; the browser only saves the bytes.
export const downloadReport = async (path: string, format: ReportFormat, fallbackName: string) => {
  const r = await api.get(path, { params: { format }, responseType: 'blob' });
  downloadBlob(r.data as Blob, filenameFrom(r.headers?.['content-disposition'], `${fallbackName}.${format}`));
};

export const exportToCSV = (data: Row[], filename: string) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = neutralizeFormula(v);
    return s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')
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
  }).toFile(`${filename}.xlsx`);
};

export const exportToMultiSheetExcel = async (
  sheets: { name: string; data: Row[] }[],
  filename: string,
) => {
  const filled = sheets.filter(s => s.data.length);
  if (!filled.length) return;
  await writeXlsxFile(
    filled.map(s => ({
      data: buildRows(s.data),
      sheet: s.name.slice(0, 31),
      columns: buildColumns(s.data),
    })),
  ).toFile(`${filename}.xlsx`);
};
