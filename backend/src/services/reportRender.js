'use strict';

/**
 * Renders report documents as DOCX and PDF on the server (3.10.0).
 *
 * A report is built once as a plain document model (services/reportService.js)
 * and rendered by two writers:
 *   - DOCX with the library "docx" (writes the OOXML itself, escapes text),
 *   - PDF with "pdfmake" (declarative layout on top of pdfkit; tables with
 *     automatic page breaks and repeated header rows), no headless browser.
 *
 * Injection: every value from the database is passed as a text run / cell
 * text - never as markup, a template, a field code or a hyperlink. Text is
 * cleaned of characters XML 1.0 does not allow (they would corrupt the DOCX)
 * and capped in length. pdfmake may load images and fonts from URLs or the
 * file system: URL access is switched off entirely, local access is limited to
 * the bundled font files. No image from user data is embedded.
 *
 * Document model:
 *   { title, subtitle?, organization?, app_name, generated_at, generated_by?,
 *     landscape?, sections: [{ heading, blocks: [block] }] }
 *   block: { type: 'p', text, bold? } | { type: 'note', text }
 *        | { type: 'nodata', text } | { type: 'kv', rows: [[key, value]] }
 *        | { type: 'list', items: [text] } | { type: 'h', text }
 *        | { type: 'table', columns: [text], rows: [[cell]], widths?: [number] }
 *        | { type: 'heatmap', title, x_label, y_label, x_labels, y_labels,
 *            cells: [[{ count, color }]] }   // first row = highest likelihood
 */

const path = require('path');

const MAX_TEXT = 4000;
// XML 1.0 forbids C0 controls except tab, LF, CR; lone surrogates break UTF-8.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g; // NOSONAR - character class, not a polynomial pattern
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function clean(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  s = s.replace(INVALID_XML, '').replace(LONE_SURROGATE, '�');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (c, fallback = '#e5e7eb') => (typeof c === 'string' && HEX.test(c) ? c : fallback);
// Text colour on a coloured cell: dark on light, white on dark.
function onColor(hex) {
  const h = color(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111827' : '#ffffff';
}

/**
 * File name for Content-Disposition: fixed prefix chosen by the server, an
 * optional slug (letters, digits, dashes only) and the date - nothing from the
 * request ends up in it unfiltered.
 */
function safeFilename(prefix, slug, ext) {
  const part = (s, max) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, max).replace(/-+$/, '');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = [part(prefix, 40) || 'report', part(slug, 40), date].filter(Boolean).join('-');
  return `${name}.${ext === 'pdf' ? 'pdf' : 'docx'}`;
}

const MIME = Object.freeze({
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
});

const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

function metaLines(doc) {
  return [
    doc.organization ? clean(doc.organization, 200) : null,
    `Erstellt am ${fmtDateTime(doc.generated_at)}${doc.generated_by ? ` von ${clean(doc.generated_by, 100)}` : ''}`,
    `Quelle: ${clean(doc.app_name || 'OpenISMS', 100)}`,
  ].filter(Boolean);
}

// ── DOCX ────────────────────────────────────────────────────────────────────

async function renderDocx(doc) {
  const D = require('docx');
  const hex = (c) => color(c).slice(1);
  const run = (text, opts = {}) => new D.TextRun({ text: clean(text), size: opts.size || 20, bold: !!opts.bold, italics: !!opts.italics, color: opts.color ? hex(opts.color) : undefined });
  const para = (text, opts = {}) => new D.Paragraph({ children: [run(text, opts)], spacing: { after: opts.after ?? 120 } });
  const cell = (text, opts = {}) => new D.TableCell({
    children: [new D.Paragraph({ children: [run(text, { size: opts.size || 16, bold: opts.bold, color: opts.textColor })], alignment: opts.center ? D.AlignmentType.CENTER : undefined })],
    shading: opts.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: hex(opts.fill) } : undefined,
    verticalAlign: D.VerticalAlign.CENTER,
  });
  const table = (columns, rows, opts = {}) => new D.Table({
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    rows: [
      new D.TableRow({ tableHeader: true, children: columns.map(c => cell(c, { bold: true, fill: '#e5e7eb', size: opts.size })) }),
      ...rows.map(r => new D.TableRow({ children: columns.map((_, i) => cell(r[i], { size: opts.size })) })),
    ],
  });
  const children = [
    new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: clean(doc.title, 300) })] }),
  ];
  if (doc.subtitle) children.push(para(doc.subtitle, { size: 24, bold: true }));
  for (const l of metaLines(doc)) children.push(para(l, { size: 18, color: '#4b5563', after: 40 }));
  for (const s of doc.sections || []) {
    children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun({ text: clean(s.heading, 300) })], spacing: { before: 240, after: 120 } }));
    for (const b of s.blocks || []) {
      switch (b.type) {
        case 'h': children.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun({ text: clean(b.text, 300) })], spacing: { before: 160, after: 80 } })); break;
        case 'p': children.push(para(b.text, { bold: b.bold })); break;
        case 'note': children.push(para(b.text, { italics: true, color: '#4b5563', size: 18 })); break;
        case 'nodata': children.push(para(b.text || 'Keine Daten.', { italics: true, color: '#b91c1c' })); break;
        case 'list': for (const it of b.items || []) children.push(new D.Paragraph({ children: [run(it)], bullet: { level: 0 } })); break;
        case 'kv': children.push(table(['', ''], (b.rows || []).map(([k, v]) => [k, v]), { size: 18 })); children.push(para('', { after: 60 })); break;
        case 'table':
          if (!b.rows || !b.rows.length) { children.push(para(b.empty || 'Keine Daten.', { italics: true, color: '#b91c1c' })); break; }
          children.push(table(b.columns, b.rows, { size: b.columns.length > 9 ? 14 : 16 }));
          children.push(para('', { after: 60 }));
          break;
        case 'heatmap': {
          if (b.title) children.push(para(b.title, { bold: true }));
          const rows = [];
          rows.push(new D.TableRow({ children: [cell(`${clean(b.y_label)} \\ ${clean(b.x_label)}`, { bold: true, size: 14 }), ...b.x_labels.map(x => cell(x, { bold: true, size: 14, center: true }))] }));
          b.cells.forEach((row, ri) => rows.push(new D.TableRow({
            children: [cell(b.y_labels[ri], { bold: true, size: 14 }), ...row.map(c => cell(c.count ? String(c.count) : '', { fill: c.color, textColor: onColor(c.color), center: true, bold: true }))],
          })));
          children.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, rows }));
          children.push(para('', { after: 60 }));
          break;
        }
        default: break;
      }
    }
  }
  const document = new D.Document({
    creator: clean(doc.app_name || 'OpenISMS', 100),
    title: clean(doc.title, 300),
    description: clean(doc.subtitle || '', 300),
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [{
      properties: { page: { size: { orientation: doc.landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT } } },
      footers: {
        default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [
          new D.TextRun({ text: `${clean(doc.title, 120)} – Seite `, size: 16, color: '6b7280' }),
          new D.TextRun({ children: [D.PageNumber.CURRENT], size: 16, color: '6b7280' }),
        ] })] }),
      },
      children,
    }],
  });
  return D.Packer.toBuffer(document);
}

// ── PDF ─────────────────────────────────────────────────────────────────────

let pdfmakeReady = null;
function pdfmake() {
  if (pdfmakeReady) return pdfmakeReady;
  const pm = require('pdfmake');
  const dir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  const fonts = {
    Roboto: {
      normal: path.join(dir, 'Roboto-Regular.ttf'),
      bold: path.join(dir, 'Roboto-Medium.ttf'),
      italics: path.join(dir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
    },
  };
  const allowedFiles = new Set(Object.values(fonts.Roboto));
  pm.setFonts(fonts);
  // No remote resources at all (no SSRF via an image URL), local files only
  // the four bundled fonts.
  pm.setUrlAccessPolicy(() => false);
  pm.setLocalAccessPolicy((p) => allowedFiles.has(path.resolve(String(p))));
  pdfmakeReady = pm;
  return pm;
}

function pdfDefinition(doc) {
  const content = [{ text: clean(doc.title, 300), style: 'title' }];
  if (doc.subtitle) content.push({ text: clean(doc.subtitle, 300), style: 'subtitle' });
  for (const l of metaLines(doc)) content.push({ text: l, style: 'meta' });
  const tbl = (columns, rows, size) => ({
    table: {
      headerRows: 1,
      dontBreakRows: false,
      widths: columns.map(() => '*'),
      body: [
        columns.map(c => ({ text: clean(c, 200), bold: true, fillColor: '#e5e7eb' })),
        ...rows.map(r => columns.map((_, i) => ({ text: clean(r[i]) }))),
      ],
    },
    layout: 'lightHorizontalLines',
    fontSize: size,
    margin: [0, 2, 0, 8],
  });
  for (const s of doc.sections || []) {
    content.push({ text: clean(s.heading, 300), style: 'h1' });
    for (const b of s.blocks || []) {
      switch (b.type) {
        case 'h': content.push({ text: clean(b.text, 300), style: 'h2' }); break;
        case 'p': content.push({ text: clean(b.text), bold: !!b.bold, margin: [0, 0, 0, 6] }); break;
        case 'note': content.push({ text: clean(b.text), italics: true, color: '#4b5563', fontSize: 8, margin: [0, 0, 0, 6] }); break;
        case 'nodata': content.push({ text: clean(b.text || 'Keine Daten.'), italics: true, color: '#b91c1c', margin: [0, 0, 0, 6] }); break;
        case 'list': content.push({ ul: (b.items || []).map(it => clean(it)), margin: [0, 0, 0, 6] }); break;
        case 'kv': content.push({ table: { widths: ['30%', '*'], body: (b.rows || []).map(([k, v]) => [{ text: clean(k, 200), bold: true }, { text: clean(v) }]) }, layout: 'lightHorizontalLines', fontSize: 9, margin: [0, 0, 0, 8] }); break;
        case 'table':
          if (!b.rows || !b.rows.length) { content.push({ text: clean(b.empty || 'Keine Daten.'), italics: true, color: '#b91c1c', margin: [0, 0, 0, 6] }); break; }
          content.push(tbl(b.columns, b.rows, b.columns.length > 9 ? 6.5 : 8));
          break;
        case 'heatmap': {
          if (b.title) content.push({ text: clean(b.title, 200), bold: true, margin: [0, 4, 0, 2] });
          const body = [
            [{ text: `${clean(b.y_label, 60)} \\ ${clean(b.x_label, 60)}`, bold: true, fontSize: 7 }, ...b.x_labels.map(x => ({ text: clean(x, 60), bold: true, fontSize: 7, alignment: 'center' }))],
            ...b.cells.map((row, ri) => [
              { text: clean(b.y_labels[ri], 60), bold: true, fontSize: 7 },
              ...row.map(c => ({ text: c.count ? String(c.count) : '', fillColor: color(c.color), color: onColor(c.color), bold: true, alignment: 'center' })),
            ]),
          ];
          content.push({ table: { widths: [90, ...b.x_labels.map(() => '*')], body }, fontSize: 9, margin: [0, 0, 0, 10] });
          break;
        }
        default: break;
      }
    }
  }
  return {
    pageSize: 'A4',
    pageOrientation: doc.landscape ? 'landscape' : 'portrait',
    pageMargins: [36, 40, 36, 40],
    info: { title: clean(doc.title, 300), author: clean(doc.organization || doc.app_name || 'OpenISMS', 200), creator: clean(doc.app_name || 'OpenISMS', 100) },
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: {
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 12, bold: true, margin: [0, 0, 0, 6] },
      meta: { fontSize: 8, color: '#4b5563' },
      h1: { fontSize: 13, bold: true, margin: [0, 12, 0, 6] },
      h2: { fontSize: 10.5, bold: true, margin: [0, 8, 0, 4] },
    },
    footer: (current, total) => ({ text: `${clean(doc.title, 120)} – Seite ${current} von ${total}`, alignment: 'right', fontSize: 7, color: '#6b7280', margin: [36, 10, 36, 0] }),
    content,
  };
}

async function renderPdf(doc) {
  return pdfmake().createPdf(pdfDefinition(doc)).getBuffer();
}

async function render(doc, format) {
  if (format === 'pdf') return renderPdf(doc);
  if (format === 'docx') return renderDocx(doc);
  const e = new Error('format muss docx oder pdf sein');
  e.status = 400;
  throw e;
}

/** Send a rendered document as a download. */
function sendDocument(res, buffer, format, filename) {
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(buffer);
}

module.exports = { clean, color, onColor, safeFilename, MIME, render, renderDocx, renderPdf, pdfDefinition, sendDocument };
