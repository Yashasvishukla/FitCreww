export type PayslipPdfLine = { readonly clientName: string; readonly paymentDate: string; readonly gross: string; readonly commission: string; readonly net: string };
export type PayslipPdfInput = { readonly payslipNumber: string; readonly businessName: string; readonly coachName: string; readonly periodStart: string; readonly periodEnd: string; readonly issuedAt: string; readonly grossRevenue: string; readonly commissionDeducted: string; readonly netPaid: string; readonly lines: readonly PayslipPdfLine[] };

/** Dependency-free PDF 1.4 writer using standard embedded viewer fonts. */
export function generatePayslipPdf(input: PayslipPdfInput): Uint8Array {
  const rowsPerPage = 24;
  const chunks = input.lines.length ? Array.from({ length: Math.ceil(input.lines.length / rowsPerPage) }, (_, index) => input.lines.slice(index * rowsPerPage, (index + 1) * rowsPerPage)) : [[]];
  const objects = new Map<number, string>();
  const pageRefs: number[] = [];
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  chunks.forEach((rows, pageIndex) => {
    const pageObject = 4 + pageIndex * 2; const contentObject = pageObject + 1; pageRefs.push(pageObject);
    const content = pageContent(input, rows, pageIndex + 1, chunks.length);
    objects.set(pageObject, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.set(contentObject, `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  objects.set(2, `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((id) => `${id} 0 R`).join(' ')}] >>`);
  const maxObject = Math.max(...objects.keys()); let pdf = '%PDF-1.4\n%FitCrew\n'; const offsets = [0];
  for (let id = 1; id <= maxObject; id += 1) { offsets[id] = byteLength(pdf); pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`; }
  const xref = byteLength(pdf); pdf += `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObject; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (character) => character.charCodeAt(0));
}

function pageContent(input: PayslipPdfInput, rows: readonly PayslipPdfLine[], page: number, pages: number): string {
  const commands: string[] = ['BT', '/F1 22 Tf', '0.08 0.2 0.38 rg', text(48, 790, 'FITCREW PAYSLIP'), '/F1 10 Tf', '0.2 0.25 0.32 rg', text(48, 766, input.businessName), text(400, 790, `Payslip ${input.payslipNumber.slice(0, 12)}`), text(400, 774, `Issued ${input.issuedAt}`), '/F1 14 Tf', text(48, 724, input.coachName), '/F1 10 Tf', text(48, 707, `Period ${input.periodStart} to ${input.periodEnd}`), '/F1 11 Tf', text(48, 665, `Gross revenue  INR ${input.grossRevenue}`), text(225, 665, `Owner commission  INR ${input.commissionDeducted}`), text(430, 665, `NET PAID  INR ${input.netPaid}`), '/F1 9 Tf', '0.35 0.4 0.48 rg', text(48, 625, 'CLIENT'), text(270, 625, 'PAYMENT DATE'), text(380, 625, 'GROSS'), text(455, 625, 'COMMISSION'), text(535, 625, 'NET')];
  let y = 604;
  for (const row of rows) { commands.push('0.12 0.15 0.2 rg', text(48, y, truncate(row.clientName, 34)), text(270, y, row.paymentDate), text(380, y, row.gross), text(455, y, row.commission), text(535, y, row.net)); y -= 21; }
  commands.push('0.4 0.45 0.52 rg', text(48, 42, 'Generated from immutable FitCrew commission accrual snapshots.'), text(500, 42, `Page ${page}/${pages}`), 'ET');
  return commands.join('\n');
}
function text(x: number, y: number, value: string): string { return `1 0 0 1 ${x} ${y} Tm (${escapePdf(ascii(value))}) Tj`; }
function ascii(value: string): string { return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '?'); }
function escapePdf(value: string): string { return value.replace(/([\\()])/g, '\\$1'); }
function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, length - 3)}...`; }
function byteLength(value: string): number { return value.length; }
