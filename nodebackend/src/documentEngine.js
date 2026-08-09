const path = require('path');
const QRCode = require('qrcode');
const config = require('./config');
const { generateDocument } = require('./pdf');

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Builds the Offer Letter PDF. Returns the absolute output path.
async function buildOfferLetter({ internNo, offerLetterId, fullName, position, department, startDate, durationLabel }) {
  const todayStr = formatDate(new Date());
  const startStr = formatDate(startDate);

  const fields = [
    { text: todayStr, xPct: 0.045, yPct: 0.135, wPct: 0.30, hPct: 0.03, size: 12, align: 'LEFT' },
    { text: offerLetterId, xPct: 0.62, yPct: 0.135, wPct: 0.35, hPct: 0.03, size: 12, align: 'LEFT' },
    { text: fullName, xPct: 0.14, yPct: 0.178, wPct: 0.3, hPct: 0.03, size: 13, bold: true, align: 'LEFT' },
    { text: position, xPct: 0.20, yPct: 0.212, wPct: 0.5, hPct: 0.03, size: 13, bold: true, align: 'LEFT' },
    { text: department, xPct: 0.20, yPct: 0.253, wPct: 0.35, hPct: 0.03, size: 13, bold: true, align: 'LEFT' },
    { text: startStr, xPct: 0.32, yPct: 0.286, wPct: 0.2, hPct: 0.03, size: 12, bold: true, align: 'LEFT' },
    { text: durationLabel, xPct: 0.62, yPct: 0.286, wPct: 0.2, hPct: 0.03, size: 12, bold: true, align: 'LEFT' }
  ];

  const outName = `${slug(fullName)}-offer-${offerLetterId.replace(/\//g, '-')}.pdf`;
  const outPath = path.join(config.PATHS.offersOut, outName);
  await generateDocument(config.PATHS.offerTemplate, fields, [], outPath);
  return outPath;
}

// Builds the Certificate PDF (with QR code). Returns the absolute output path.
async function buildCertificate({ fullName, position, department, startDate, endDate, certificateId }) {
  const todayStr = formatDate(new Date());
  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  const verifyUrl = `${config.VERIFY_PAGE_URL}?certId=${encodeURIComponent(certificateId)}`;
  const qrBytes = await QRCode.toBuffer(verifyUrl, { width: 240, margin: 1 });

  const fields = [
    { text: fullName, xPct: 0.30, yPct: 0.40, wPct: 0.4, hPct: 0.04, size: 20, align: 'CENTER' },
    { text: position, xPct: 0.62, yPct: 0.475, wPct: 0.34, hPct: 0.03, size: 12, bold: true, align: 'LEFT' },
    { text: department, xPct: 0.30, yPct: 0.507, wPct: 0.32, hPct: 0.03, size: 12, bold: true, align: 'LEFT' },
    { text: startStr, xPct: 0.48, yPct: 0.540, wPct: 0.18, hPct: 0.03, size: 11, bold: true, align: 'LEFT' },
    { text: endStr, xPct: 0.72, yPct: 0.540, wPct: 0.2, hPct: 0.03, size: 11, bold: true, align: 'LEFT' },
    { text: certificateId, xPct: 0.20, yPct: 0.812, wPct: 0.3, hPct: 0.025, size: 11, align: 'LEFT' },
    { text: todayStr, xPct: 0.20, yPct: 0.838, wPct: 0.3, hPct: 0.025, size: 11, align: 'LEFT' }
  ];
  const images = [
    { bytes: qrBytes, isJpg: false, xPct: 0.83, yPct: 0.80, wPct: 0.12, hPct: 0.09 }
  ];

  const outName = `${slug(fullName)}-certificate-${certificateId}.pdf`;
  const outPath = path.join(config.PATHS.certsOut, outName);
  await generateDocument(config.PATHS.certTemplate, fields, images, outPath);
  return outPath;
}

function slug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'intern';
}

module.exports = { buildOfferLetter, buildCertificate, formatDate };
