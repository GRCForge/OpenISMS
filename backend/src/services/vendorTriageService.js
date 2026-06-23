const fs = require('fs');
const path = require('path');
const { callLlm, getLlmConfig } = require('./llmService');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

async function extractText(filePath, mimetype) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
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

const SYSTEM_PROMPT = `You are a compliance expert specializing in data protection law (GDPR/DSGVO), information security (ISO 27001:2022), and digital operational resilience (DORA). Your task is to analyze vendor compliance documents (Data Processing Agreements / AVV, Technical and Organizational Measures / TOM, SOC2 reports) and identify compliance gaps, violations, and deviations.

You MUST respond with ONLY valid JSON — no markdown, no explanation text outside the JSON structure.

Analyze against these frameworks:
1. GDPR Art. 28 (Data Processing Agreement requirements):
   - Art. 28(3)(a): Processing only on instructions
   - Art. 28(3)(b): Confidentiality obligations
   - Art. 28(3)(c): Technical/organizational measures (Art. 32)
   - Art. 28(3)(d): Sub-processor obligations
   - Art. 28(3)(e): Support for data subject rights
   - Art. 28(3)(f): Data deletion/return obligations
   - Art. 28(3)(g): Audit support and evidence
   - Art. 28(3)(h): Right to audit / on-site inspections

2. ISO/IEC 27001:2022 (relevant controls for vendor documents):
   - A.5.19: Information security in supplier relationships
   - A.5.20: Addressing security in supplier agreements
   - Control 8.24: Use of cryptography
   - A.5.35: Independent review of information security

3. DORA proximity (for ICT third-party risk):
   - ICT third-party risk management (Art. 28)
   - Exit strategy / portability
   - Sub-vendor disclosure

Assign a severity to each finding:
- "critical": Clear legal violation, missing mandatory clause, or right explicitly excluded
- "warning": Deviation from best practice, weak formulation, or insufficient specificity
- "gap": Missing element that should be present, unclear clause, or notable absence

Respond with this exact JSON structure:
{
  "risk_level": "low|medium|high|critical",
  "summary": "2-3 sentence executive summary of the document and overall risk assessment",
  "findings": [
    {
      "finding_ref": "VRM-001",
      "severity": "critical|warning|gap",
      "title": "Short title of the finding",
      "framework": "GDPR|ISO27001|DORA|GENERAL",
      "control_ref": "e.g. GDPR Art. 28(3)(h)",
      "quote": "Verbatim problematic text from the document (max 200 chars), or null if absence-based",
      "description": "Detailed explanation of why this is a problem",
      "remediation": "Concrete recommendation to fix this finding"
    }
  ]
}

If the document looks compliant with no major issues, return an empty findings array and risk_level "low".
Limit findings to the most important ones (max 10). Number finding_ref sequentially: VRM-001, VRM-002, etc.`;

function buildUserPrompt(docType, text) {
  const docTypeLabel = {
    avv: 'Data Processing Agreement (AVV/DPA)',
    tom: 'Technical and Organizational Measures (TOM)',
    soc2: 'SOC2 Report',
    other: 'Vendor Compliance Document',
  }[docType] || 'Vendor Compliance Document';

  // Truncate to ~12k chars to stay within typical context limits
  const truncated = text.length > 12000 ? text.slice(0, 12000) + '\n\n[Document truncated for analysis]' : text;

  return `Document type: ${docTypeLabel}

Document content:
---
${truncated}
---

Analyze this document for compliance gaps and return the JSON findings.`;
}

function parseTriageResult(rawText) {
  // Strip markdown code fences if present
  let text = rawText.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON object from the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('LLM did not return valid JSON');
  }
}

async function runTriage(triageRunId) {
  const { VendorTriageRun, VendorFinding, Document } = require('../models');

  const run = await VendorTriageRun.findByPk(triageRunId, {
    include: [{ model: Document, as: 'document' }],
  });
  if (!run) throw new Error(`Triage run ${triageRunId} not found`);

  await run.update({ status: 'running', started_at: new Date() });

  try {
    const doc = run.document;
    if (!doc) throw new Error('Document not found for triage run');

    const filePath = path.join(UPLOAD_DIR, doc.filename);
    if (!fs.existsSync(filePath)) throw new Error(`Document file not found: ${doc.filename}`);

    const text = await extractText(filePath, doc.mimetype);
    if (!text || text.trim().length < 50) throw new Error('Document text too short to analyze');

    const llmConfig = await getLlmConfig();
    const { text: rawResult, provider, model } = await callLlm({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(run.doc_type, text),
    });

    const result = parseTriageResult(rawResult);

    // Validate required fields
    if (!result.findings || !Array.isArray(result.findings)) {
      throw new Error('LLM response missing findings array');
    }

    // Store findings
    const findingRows = result.findings.map((f, i) => ({
      triage_run_id: run.id,
      vendor_id: run.vendor_id,
      finding_ref: f.finding_ref || `VRM-${String(i + 1).padStart(3, '0')}`,
      severity: ['critical', 'warning', 'gap'].includes(f.severity) ? f.severity : 'gap',
      title: String(f.title || 'Finding').slice(0, 500),
      framework: String(f.framework || '').slice(0, 100),
      control_ref: String(f.control_ref || '').slice(0, 200),
      quote: f.quote ? String(f.quote).slice(0, 1000) : null,
      description: f.description || null,
      remediation: f.remediation || null,
    }));

    if (findingRows.length > 0) {
      await VendorFinding.bulkCreate(findingRows);
    }

    await run.update({
      status: 'done',
      completed_at: new Date(),
      risk_level: ['low', 'medium', 'high', 'critical'].includes(result.risk_level) ? result.risk_level : 'medium',
      summary: result.summary || null,
      llm_provider: provider,
      llm_model: model,
    });

    return run;
  } catch (err) {
    await run.update({
      status: 'error',
      completed_at: new Date(),
      error_message: err.message,
    });
    throw err;
  }
}

module.exports = { runTriage };
