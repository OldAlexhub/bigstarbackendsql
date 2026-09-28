// Shared pdfkit table-drawing helpers, extracted from the ELT Reporting PDF
// export (the only place pdfkit was used before this) so a second report
// (the Leaderboard) doesn't have to re-solve the same two hard-won details:
// row height measured per-row via doc.heightOfString so wrapped text never
// overlaps the next row, and manual pagination since pdfkit doesn't paginate
// tables on its own.

// doc.x does NOT reset to the page's left margin after an explicit-position
// .text(str, x, y, {...}) call — it's left at wherever that call drew.
// Callers should capture doc.page.margins.left once and always anchor
// tables to it, rather than trusting doc.x, to avoid tables drifting right
// on every subsequent draw.
export const pdfPageLeft = (doc) => doc.page.margins.left;

const rowHeight = (doc, cells, colWidths, fontSize) =>
  Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ""), { width: colWidths[i] }))) + fontSize * 0.6;

const drawRow = (doc, cells, colWidths, startX, y) => {
  cells.forEach((c, i) => {
    doc.text(String(c ?? ""), startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
  });
};

// Draws a titled table starting at the current doc.y, paginating
// automatically when a row would run past the bottom margin.
export const drawPdfTable = (doc, pageLeft, title, headers, tableRows, colWidths) => {
  doc.x = pageLeft;
  doc.fillColor("#000").fontSize(13).text(title, pageLeft, doc.y);
  doc.moveDown(0.3);
  const startX = pageLeft;
  let y = doc.y;

  doc.fontSize(8).fillColor("#333");
  const headerHeight = rowHeight(doc, headers, colWidths, 8);
  drawRow(doc, headers, colWidths, startX, y);
  y += headerHeight;

  doc.fontSize(9).fillColor("#000");
  if (tableRows.length === 0) {
    doc.text("None", startX, y);
    y += 14;
  }
  tableRows.forEach((row) => {
    const h = rowHeight(doc, row, colWidths, 9);
    if (y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    drawRow(doc, row, colWidths, startX, y);
    y += h;
  });
  doc.y = y + 12;
};
