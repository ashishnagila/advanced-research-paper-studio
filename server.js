import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import mammoth from "mammoth";
import multer from "multer";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Footer, PageNumber
} from "docx";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const maxUpload = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 15));
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"], connectSrc: ["'self'", "https://api.crossref.org"],
    objectSrc: ["'none'"], upgradeInsecureRequests: []
  }
}}));
const allowed = (process.env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) {
  if (!origin || !allowed.length || allowed.includes(origin)) return cb(null, true);
  return cb(new Error("Origin not allowed"));
}}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public")));
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: 45, standardHeaders: "draft-7", legacyHeaders: false }));

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try { await fs.mkdir(path.join(root, "uploads"), { recursive: true }); cb(null, path.join(root, "uploads")); }
    catch (e) { cb(e); }
  },
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID())
});
const upload = multer({
  storage,
  limits: { fileSize: maxUpload * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".docx") return cb(new Error("Only .docx files are supported in this version."));
    cb(null, true);
  }
});

function requireAppAccess(req, res, next) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(503).json({ error: "Server setup incomplete: APP_PASSWORD must be set." });
  const supplied = req.get("x-app-password") || "";
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Incorrect app password." });
  next();
}
function requireAI(res) {
  if (!openai) { res.status(503).json({ error: "AI is not configured. Set OPENAI_API_KEY in the server environment." }); return false; }
  return true;
}
function cleanText(v, max = 20000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
function modelName() { return process.env.OPENAI_MODEL || "gpt-5.5"; }

app.get("/api/health", (_req, res) => res.json({
  ok: true, aiConfigured: Boolean(openai), appPasswordRequired: Boolean(process.env.APP_PASSWORD),
  model: modelName()
}));
app.use("/api/private", requireAppAccess);

// Main drafting endpoint: one section or complete manuscript scaffold/draft.
app.post("/api/private/generate", async (req, res) => {
  if (!requireAI(res)) return;
  const b = req.body || {};
  const topic = cleanText(b.topic, 600);
  if (!topic) return res.status(400).json({ error: "Research topic is required." });
  const section = cleanText(b.section, 100) || "Complete manuscript draft";
  const findings = cleanText(b.findings, 12000);
  const references = cleanText(b.references, 12000);
  const useWeb = Boolean(b.useWeb);
  const prompt = `Prepare: ${section}
Research title/topic: ${topic}
Field: ${cleanText(b.discipline, 200) || "Not specified"}
Article type: ${cleanText(b.paperType, 100) || "Research article"}
Target style: ${cleanText(b.style, 100) || "IEEE"}
Target length: ${cleanText(b.length, 50) || "As appropriate"}
Research question/objective: ${cleanText(b.objective, 3000) || "Not supplied"}
Methodology and dataset: ${cleanText(b.method, 8000) || "Not supplied"}
Actual results/findings: ${findings || "Not supplied"}
Author-supplied references: ${references || "Not supplied"}

Requirements:
- Write original, careful academic prose and use clear Markdown headings.
- Never invent experiments, samples, datasets, numerical results, quotations, DOIs, authors, journal titles or citations.
- If evidence, methods, results, or bibliographic details are missing, mark [AUTHOR INPUT REQUIRED: ...].
- Do not represent a narrative review as systematic/scoping; do not claim PRISMA or registration unless supplied.
- If writing Results and no real findings are supplied, provide a results-reporting template with placeholders, not made-up outcomes.
- If references are supplied, cite only those references and do not alter their metadata.
- If web research is enabled, cite only sources actually returned by web search, with source titles and working URLs where available; clearly distinguish web-found sources from author-supplied references.
- Include a brief final checklist of facts and citations the author must verify.`;
  try {
    const params = { model: modelName(), input: prompt };
    if (useWeb) params.tools = [{ type: "web_search" }];
    const result = await openai.responses.create(params);
    res.json({ text: result.output_text || "", model: modelName(), webResearch: useWeb });
  } catch (e) {
    console.error("generate:", e.message);
    res.status(500).json({ error: e.message || "Generation failed." });
  }
});

// Review a manuscript for structure, method clarity, limitations and likely reviewer concerns.
app.post("/api/private/review", async (req, res) => {
  if (!requireAI(res)) return;
  const manuscript = cleanText(req.body?.manuscript, 50000);
  if (manuscript.length < 100) return res.status(400).json({ error: "Paste at least 100 characters of manuscript text." });
  try {
    const result = await openai.responses.create({
      model: modelName(),
      input: `Act as a rigorous but constructive academic peer reviewer. Analyze the manuscript below.
Return: (1) brief overall assessment, (2) major issues, (3) minor issues, (4) methodology/data transparency checks, (5) citation/reference checks that require human verification, (6) prioritized revision plan.
Do not invent journal policies, sources, data or factual claims. Do not predict acceptance.
Manuscript:\n${manuscript}`
    });
    res.json({ text: result.output_text || "" });
  } catch (e) { console.error("review:", e.message); res.status(500).json({ error: e.message || "Review failed." }); }
});

// Crossref discovery: metadata only; user must verify relevance and source quality.
app.get("/api/private/references", async (req, res) => {
  const q = cleanText(req.query.q, 500);
  if (q.length < 3) return res.status(400).json({ error: "Enter at least 3 characters." });
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=12&select=DOI,title,author,published,created,container-title,type`;
    const r = await fetch(url, { headers: { "User-Agent": "AdvancedResearchPaperStudio/2.0 (mailto:admin@example.com)" } });
    if (!r.ok) throw new Error(`Crossref returned ${r.status}`);
    const data = await r.json();
    const items = (data.message?.items || []).map(x => ({
      title: x.title?.[0] || "Untitled",
      authors: (x.author || []).map(a => [a.given, a.family].filter(Boolean).join(" ")).join(", "),
      year: x.published?.["date-parts"]?.[0]?.[0] || x.created?.["date-parts"]?.[0]?.[0] || "",
      journal: x["container-title"]?.[0] || "",
      doi: x.DOI || "", type: x.type || "",
      url: x.DOI ? `https://doi.org/${x.DOI}` : ""
    }));
    res.json({ items });
  } catch (e) { res.status(502).json({ error: e.message || "Reference lookup failed." }); }
});

// Upload DOCX, extract text, reflow into target convention, export DOCX.
// This is not a publisher-certified template converter and does not preserve original embedded objects.
app.post("/api/private/format", upload.single("manuscript"), async (req, res) => {
  const file = req.file;
  if (!requireAI(res)) {
    if (file) await fs.unlink(file.path).catch(() => {});
    return;
  }
  if (!file) return res.status(400).json({ error: "Choose a .docx file." });
  try {
    const { value } = await mammoth.extractRawText({ path: file.path });
    const manuscript = value.trim();
    if (manuscript.length < 100) throw new Error("Could not extract enough text from this DOCX.");
    if (manuscript.length > 60000) throw new Error("Manuscript exceeds the 60,000-character MVP limit. Split it into sections.");
    const style = cleanText(req.body.style, 30) || "IEEE";
    const guide = {
      IEEE: "IEEE conventions: title, abstract, index terms, numbered sections, concise technical style, numbered references.",
      Springer: "Springer article conventions: title, abstract, keywords, numbered or unnumbered sections, declarations only when information is provided.",
      Elsevier: "Elsevier article conventions: title, abstract, keywords, numbered sections, declarations only when information is provided.",
      "APA 7": "APA 7 conventions: title, abstract if applicable, heading levels and author-date citation style.",
      ACM: "ACM conventions: title, abstract, CCS concepts/keywords placeholders where applicable, numbered sections and references.",
      Vancouver: "Vancouver conventions: numbered in-text citations and numbered references."
    }[style] || "Use a conventional scholarly structure.";
    const result = await openai.responses.create({
      model: modelName(),
      input: `Reorganize the following manuscript for ${style}.
Style guidance: ${guide}
Preserve all claims, author names, numbers, equations as text, and reference entries. Do not fabricate or add citations, DOIs, affiliations, results, declarations, or data. Do not silently remove content.
If a required element is missing, insert [AUTHOR INPUT REQUIRED: ...].
Use Markdown headings (#, ##, ###). Mark any original figure/table whose placement cannot be retained with [CHECK ORIGINAL FIGURE/TABLE].
Important: this is text-only reflow. Exact journal-specific templates and formatting rules must be checked separately.
MANUSCRIPT:\n${manuscript}`
    });
    const md = result.output_text || "";
    const children = md.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 260 } });
      if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
      if (line.startsWith("### ")) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 90 } });
      return new Paragraph({ children: [new TextRun(line.replace(/\*\*/g, "").replace(/\*/g, ""))], alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 } });
    });
    const doc = new Document({ sections: [{ properties: {}, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }] });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${style.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reflowed.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error("format:", e.message);
    res.status(500).json({ error: e.message || "Formatting failed." });
  } finally { await fs.unlink(file.path).catch(() => {}); }
});

// Export supplied markdown/plain text as a DOCX.
app.post("/api/private/export-docx", async (req, res) => {
  const title = cleanText(req.body?.title, 300) || "Research Manuscript";
  const body = cleanText(req.body?.body, 60000);
  if (!body) return res.status(400).json({ error: "There is no manuscript text to export." });
  const paragraphs = body.split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(line => {
    if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER });
    if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1 });
    if (line.startsWith("### ")) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_2 });
    return new Paragraph({ children: [new TextRun(line.replace(/\*\*/g, ""))], alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 } });
  });
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }), ...paragraphs] }] });
  const buffer = await Packer.toBuffer(doc);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", 'attachment; filename="research-manuscript.docx"');
  res.send(buffer);
});

app.get("*", (_req, res) => res.sendFile(path.join(root, "public", "index.html")));
app.use((err, _req, res, _next) => {
  console.error("request:", err.message);
  res.status(err.status || 500).json({ error: err.message || "Unexpected server error." });
});
app.listen(port, () => console.log(`Advanced Research Paper Studio listening on ${port}`));
