import ExcelJS from 'exceljs';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
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

const buildSheet = (ws: ExcelJS.Worksheet, data: Record<string, unknown>[]) => {
  const headers = Object.keys(data[0]);
  ws.columns = headers.map(key => ({
    header: key,
    key,
    width: Math.max(key.length, ...data.slice(0, 200).map(r => String(r[key] ?? '').length)) + 2,
  }));
  ws.addRows(data);
  ws.getRow(1).font = { bold: true };
};

export const exportToExcel = async (data: Record<string, unknown>[], filename: string, sheetName = 'Export') => {
  if (!data.length) return;
  const wb = new ExcelJS.Workbook();
  buildSheet(wb.addWorksheet(sheetName.slice(0, 31)), data);
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
};

export const exportToMultiSheetExcel = async (
  sheets: { name: string; data: Record<string, unknown>[] }[],
  filename: string,
) => {
  const wb = new ExcelJS.Workbook();
  for (const { name, data } of sheets) {
    if (!data.length) continue;
    buildSheet(wb.addWorksheet(name.slice(0, 31)), data);
  }
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
};
