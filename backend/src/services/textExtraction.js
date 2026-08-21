const fs = require('fs');
const path = require('path');

async function extractText(filePath, mimetype) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    // pdf-parse 2.x replaced the old callable pdf(buffer) API with a class:
    // new PDFParse({ data }).getText(), and the parser must be destroy()ed
    // afterwards to release its worker/memory.
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx' || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.txt' || mimetype === 'text/plain') {
    return fs.readFileSync(filePath, 'utf8');
  }

  throw new Error(`Unsupported file type for triage: ${ext}`);
}

module.exports = { extractText };
