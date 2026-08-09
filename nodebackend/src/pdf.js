// Renders the Offer Letter / Certificate PDFs by drawing text (and a QR
// code, for certificates) on top of your template JPGs. Positions are
// given as percentages (0–1) of the page, matching the original Apps
// Script version's xPct/yPct/wPct/hPct convention: xPct/yPct is the
// top-left corner of a text box, hPct is its height, and text is
// vertically centered within that box.

const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INK = rgb(0.043, 0.051, 0.063); // near-black, matches the templates' text color

async function generateDocument(templatePath, textFields, imageFields, outPath) {
  const pdfDoc = await PDFDocument.create();
  const jpgBytes = fs.readFileSync(templatePath);
  const jpgImage = await pdfDoc.embedJpg(jpgBytes);
  const { width, height } = jpgImage.scale(1);

  const page = pdfDoc.addPage([width, height]);
  page.drawImage(jpgImage, { x: 0, y: 0, width, height });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const f of textFields) {
    const text = f.text == null ? '' : String(f.text);
    if (!text) continue;
    const useFont = f.bold ? boldFont : font;
    const size = f.size || 13;

    const boxX = f.xPct * width;
    const boxW = f.wPct * width;
    const boxH = f.hPct * height;
    const boxBottomY = height - (f.yPct * height) - boxH;

    const textWidth = useFont.widthOfTextAtSize(text, size);
    let x = boxX; // LEFT (default)
    if (f.align === 'CENTER') x = boxX + (boxW - textWidth) / 2;
    else if (f.align === 'RIGHT') x = boxX + boxW - textWidth;

    const y = boxBottomY + (boxH - size) / 2 + size * 0.15;

    page.drawText(text, { x, y, size, font: useFont, color: f.color || INK });
  }

  for (const f of imageFields || []) {
    const img = f.isJpg ? await pdfDoc.embedJpg(f.bytes) : await pdfDoc.embedPng(f.bytes);
    const boxW = f.wPct * width;
    const boxH = f.hPct * height;
    const x = f.xPct * width;
    const y = height - (f.yPct * height) - boxH;
    page.drawImage(img, { x, y, width: boxW, height: boxH });
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
  return outPath;
}

module.exports = { generateDocument };
