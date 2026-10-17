import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// The Business Idea Brief (EDP form) built from a completed chat review (M-05 chat, D-33): the same header and the
// ten printed questions, in the printed order, with each response quoting the person's own answers (translated to
// English by the reading pipeline). Nothing is summarised or invented here; an unanswered question says so.

type BankField = { form?: { number: number; question: string }; wordings?: { en?: string[] } };
const bank = JSON.parse(readFileSync(new URL('../../../../data/seed/question-bank.json', import.meta.url), 'utf8')) as { fields: Record<string, BankField> };
export const FORM = Object.entries(bank.fields)
  .filter((entry): entry is [string, Required<Pick<BankField, 'form'>> & BankField] => !!entry[1].form)
  .map(([key, field]) => ({ key, number: field.form.number, question: field.form.question, topic: field.wordings?.en?.[0] }))
  .sort((a, b) => a.number - b.number);

type ReviewField = { state?: string; evidence?: string[] };
export type ReviewForBrief = {
  status?: string;
  fields?: Record<string, ReviewField>;
  segments?: Array<{ segId: string; textEn?: string }>;
  declined?: Record<string, string>;
  businessType?: string | null;
};
export type BriefRow = { number: number; key: string; question: string; response: string; state: 'answered' | 'declined' | 'missing' };

const TOKENS: Record<string, string> = { PHONE: '[phone withheld]', EMAIL: '[email withheld]', NAME: '[name withheld]', ADDRESS: '[address withheld]', ID: '[ID withheld]' };

/** The ten responses, each from the review's cited segments for that field. */
export function briefRows(review: ReviewForBrief): BriefRow[] {
  const text = new Map((review.segments ?? []).map(segment => [segment.segId, segment.textEn ?? '']));
  return FORM.map(({ key, number, question, topic }) => {
    const field = review.fields?.[key];
    const declined = review.declined?.[key] && !review.declined[key]!.startsWith('Still unclear');
    if (declined) return { number, key, question, response: 'Not decided yet.', state: 'declined' };
    const lines = [...new Set((field?.state === 'answered' ? field.evidence ?? [] : []).map(id => text.get(id) ?? '').filter(Boolean)
      // Answers read from a filled form carry their question ("What products… — tailoring"); the brief prints the
      // question already, so only the answer is kept.
      .map(line => (topic && line.startsWith(`${topic} — `) ? line.slice(topic.length + 3) : line).trim()))];
    return lines.length ? { number, key, question, response: lines.join(' '), state: 'answered' }
      : { number, key, question, response: 'Not provided.', state: 'missing' };
  });
}

// The standard PDF fonts cover Latin text only (WinAnsi). Redaction tokens become plain words; anything else the
// fonts cannot draw is reported to the caller rather than silently dropped.
function printable(value: string, font: PDFFont) {
  const plain = value.replace(/⟨([A-Z]+)⟩/g, (_, kind: string) => TOKENS[kind] ?? '[withheld]').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/₹/g, 'Rs ').replace(/\s+/g, ' ').trim();
  try { font.encodeText(plain); return { text: plain, complete: true }; } catch { /* falls through */ }
  const kept = [...plain].filter(char => { try { font.encodeText(char); return true; } catch { return false; } }).join('');
  return { text: kept.replace(/\s+/g, ' ').trim(), complete: false };
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) { line = next; continue; }
      lines.push(line);
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

// Row bands of the printed form (points from the top of an A4 page), as read by ai/ingest/edp_pdf.py ROWS.
const TEMPLATE_ROWS = [
  { page: 0, top: 216, bottom: 259 }, { page: 0, top: 259, bottom: 302 }, { page: 0, top: 302, bottom: 341 },
  { page: 1, top: 94, bottom: 136 }, { page: 1, top: 136, bottom: 179 }, { page: 1, top: 179, bottom: 222 },
  { page: 1, top: 222, bottom: 276 }, { page: 1, top: 276, bottom: 319 }, { page: 1, top: 319, bottom: 350 },
  { page: 1, top: 350, bottom: 390 },
];

type Fit = { question: string[]; questionSize: number; questionLeading: number; response: string[]; responseSize: number; responseLeading: number };
/** Font sizes that keep every question and response inside its printed band, or null when one cannot fit. */
function templateFit(rows: BriefRow[], font: PDFFont): Fit[] | null {
  if (rows.length !== TEMPLATE_ROWS.length) return null;
  const fits: Fit[] = [];
  for (const [index, row] of rows.entries()) {
    const room = TEMPLATE_ROWS[index]!.bottom - TEMPLATE_ROWS[index]!.top - 6;
    const shrink = (text: string, width: number) => {
      for (let size = 9.5; size >= 6.5; size -= 0.5) {
        const leading = size * 1.15;
        const lines = wrap(text, font, size, width);
        if ((lines.length - 1) * leading + size <= room) return { lines, size, leading };
      }
      return null;
    };
    const question = shrink(row.question, 208);
    const response = shrink(printable(row.response, font).text, 228);
    if (!question || !response) return null;
    fits.push({ question: question.lines, questionSize: question.size, questionLeading: question.leading,
      response: response.lines, responseSize: response.size, responseLeading: response.leading });
  }
  return fits;
}

export type BriefInput = { name: string | null; mobile: string | null; business: string | null; rows: BriefRow[] };

/** A4 brief in the organiser form's layout; returns the PDF and whether every value could be drawn. */
export async function buildBrief(input: BriefInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Business Idea Brief');
  pdf.setProducer('PitchPrism');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [595.28, 841.89];
  const ink = rgb(0, 0, 0);
  const answerInk = rgb(0.13, 0.2, 0.5);
  const grey = rgb(0.6, 0.6, 0.6);
  let complete = true;
  const draw = (page: PDFPage, value: string, x: number, y: number, size: number, font: PDFFont, color = ink) => {
    const result = printable(value, font);
    complete &&= result.complete;
    page.drawText(result.text, { x, y, size, font, color });
  };
  const masthead = (page: PDFPage) => {
    const title = 'TATA STRIVE';
    page.drawText(title, { x: (width - bold.widthOfTextAtSize(title, 20)) / 2, y: height - 60, size: 20, font: bold });
    const tag = 'Right Skills. Bright Future.';
    page.drawText(tag, { x: (width - regular.widthOfTextAtSize(tag, 6)) / 2, y: height - 70, size: 6, font: regular, color: grey });
  };

  // Template mode: the organiser form's own geometry (rows 1-3 on page 1, 4-10 on page 2, fixed bands), so any reader
  // of that form, including the centre PDF evaluator (ai/ingest/edp_pdf.py), reads the brief like a filled form.
  // A long answer shrinks to 6.5 pt at most; anything longer uses the flowing layout below.
  const template = templateFit(input.rows, regular);
  let page = pdf.addPage([width, height]);
  masthead(page);
  const heading = 'Entrepreneurship Development Programme';
  page.drawText(heading, { x: (width - bold.widthOfTextAtSize(heading, 14)) / 2, y: height - 95, size: 14, font: bold });
  let y = height - (template ? 131 : 122);
  for (const [label, value] of [['Name of the Applicant:', input.name], ['Mobile Number:', input.mobile], ['Interested Business:', input.business]] as const) {
    page.drawText(label, { x: 52, y, size: 9.5, font: regular });
    const x = 52 + regular.widthOfTextAtSize(label, 9.5) + 6;
    draw(page, value || 'Not provided', x, y, 9.5, regular, answerInk);
    page.drawLine({ start: { x: x - 2, y: y - 2 }, end: { x: 470, y: y - 2 }, thickness: 0.5, color: ink });
    y -= 15;
  }

  // Columns as on the printed form: Q.No., Questions, Response.
  const [left, numberRight, questionRight, right] = [52, 92, 310, 548];
  const size = 9.5;
  const leading = 11;
  const header = (top: number, withTitle: boolean) => {
    let at = top;
    if (withTitle) {
      page.drawRectangle({ x: left, y: at - 17, width: right - left, height: 17, color: grey, borderColor: ink, borderWidth: 0.5 });
      page.drawText('Business Idea Brief', { x: left + 5, y: at - 12, size: 9.5, font: bold, color: rgb(1, 1, 1) });
      at -= 17;
    }
    page.drawRectangle({ x: left, y: at - 17, width: right - left, height: 17, color: grey, borderColor: ink, borderWidth: 0.5 });
    for (const [label, x] of [['Q.No.', left + 4], ['Questions', numberRight + 5], ['Response', questionRight + 5]] as const) {
      page.drawText(label, { x, y: at - 12, size: 9.5, font: bold, color: rgb(1, 1, 1) });
    }
    return at - 17;
  };
  if (template) {
    header(height - 182, true);
    const second = pdf.addPage([width, height]);
    masthead(second);
    input.rows.forEach((row, index) => {
      const band = TEMPLATE_ROWS[index]!;
      const target = band.page === 0 ? page : second;
      const fit = template[index]!;
      const top = height - band.top;
      const rowHeight = band.bottom - band.top;
      target.drawRectangle({ x: left, y: top - rowHeight, width: right - left, height: rowHeight, borderColor: ink, borderWidth: 0.5 });
      for (const x of [numberRight, questionRight]) target.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.5, color: ink });
      target.drawText(String(row.number), { x: (left + numberRight) / 2 - regular.widthOfTextAtSize(String(row.number), size) / 2, y: top - rowHeight / 2 - 3, size, font: regular });
      fit.question.forEach((line, i) => target.drawText(line, { x: numberRight + 5, y: top - 10 - i * fit.questionLeading, size: fit.questionSize, font: regular }));
      fit.response.forEach((line, i) => target.drawText(line, { x: questionRight + 5, y: top - 10 - i * fit.responseLeading, size: fit.responseSize, font: regular,
        color: row.state === 'answered' ? answerInk : grey }));
      complete &&= printable(row.response, regular).complete;
    });
    return { pdf: Buffer.from(await pdf.save()), complete };
  }
  y = header(y - 8, true);
  for (const row of input.rows) {
    const question = wrap(row.question, regular, size, questionRight - numberRight - 10);
    const response = wrap(printable(row.response, regular).text, regular, size, right - questionRight - 10);
    complete &&= printable(row.response, regular).complete;
    const rowHeight = Math.max(question.length, response.length) * leading + 8;
    if (y - rowHeight < 50) {
      page = pdf.addPage([width, height]);
      masthead(page);
      y = height - 85;
    }
    page.drawRectangle({ x: left, y: y - rowHeight, width: right - left, height: rowHeight, borderColor: ink, borderWidth: 0.5 });
    for (const x of [numberRight, questionRight]) page.drawLine({ start: { x, y }, end: { x, y: y - rowHeight }, thickness: 0.5, color: ink });
    const middle = y - rowHeight / 2 - 3;
    page.drawText(String(row.number), { x: (left + numberRight) / 2 - regular.widthOfTextAtSize(String(row.number), size) / 2, y: middle, size, font: regular });
    question.forEach((line, index) => page.drawText(line, { x: numberRight + 5, y: y - 12 - index * leading, size, font: regular }));
    response.forEach((line, index) => page.drawText(line, { x: questionRight + 5, y: y - 12 - index * leading, size, font: regular,
      color: row.state === 'answered' ? answerInk : grey }));
    y -= rowHeight;
  }
  return { pdf: Buffer.from(await pdf.save()), complete };
}
