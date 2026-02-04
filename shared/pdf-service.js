/**
 * PDF Service
 * Generates PDFs from markdown content and uploads to Supabase storage
 * Uses jsPDF for client-side PDF generation
 */

import { supabase } from './supabase.js';

// Constants for PDF generation
const PAGE_WIDTH = 210; // A4 width in mm
const PAGE_HEIGHT = 297; // A4 height in mm
const MARGIN_LEFT = 20;
const MARGIN_RIGHT = 20;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_HEIGHT = 7;
const FONT_SIZE_BODY = 11;
const FONT_SIZE_H1 = 18;
const FONT_SIZE_H2 = 14;
const FONT_SIZE_H3 = 12;

/**
 * Parse markdown-like content and render to PDF
 * Supports: # headers, **bold**, bullet lists, horizontal rules
 */
async function generateLeasePdf(markdownContent, filename = 'lease-agreement.pdf') {
  // Dynamically load jsPDF from CDN if not already loaded
  if (typeof window.jspdf === 'undefined') {
    await loadJsPDF();
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let y = MARGIN_TOP;

  // Split content into lines
  const lines = markdownContent.split('\n');

  for (const line of lines) {
    // Check if we need a new page
    if (y > PAGE_HEIGHT - MARGIN_BOTTOM - 20) {
      doc.addPage();
      y = MARGIN_TOP;
    }

    // Parse and render the line
    y = renderLine(doc, line, y);
  }

  // Return the PDF as a blob
  const pdfBlob = doc.output('blob');
  return {
    blob: pdfBlob,
    filename,
    doc, // Return doc in case caller wants to save directly
  };
}

/**
 * Load jsPDF from CDN
 */
function loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (typeof window.jspdf !== 'undefined') {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load jsPDF'));
    document.head.appendChild(script);
  });
}

/**
 * Render a single line of markdown-like content
 */
function renderLine(doc, line, y) {
  const trimmedLine = line.trim();

  // Empty line - add small space
  if (!trimmedLine) {
    return y + 4;
  }

  // Horizontal rule
  if (trimmedLine === '---' || trimmedLine === '***') {
    doc.setDrawColor(200, 200, 200);
    doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
    return y + 8;
  }

  // Headers
  if (trimmedLine.startsWith('# ')) {
    doc.setFontSize(FONT_SIZE_H1);
    doc.setFont('helvetica', 'bold');
    const text = trimmedLine.substring(2);
    doc.text(text, MARGIN_LEFT, y);
    return y + LINE_HEIGHT + 6;
  }

  if (trimmedLine.startsWith('## ')) {
    doc.setFontSize(FONT_SIZE_H2);
    doc.setFont('helvetica', 'bold');
    const text = trimmedLine.substring(3);
    doc.text(text, MARGIN_LEFT, y);
    return y + LINE_HEIGHT + 4;
  }

  if (trimmedLine.startsWith('### ')) {
    doc.setFontSize(FONT_SIZE_H3);
    doc.setFont('helvetica', 'bold');
    const text = trimmedLine.substring(4);
    doc.text(text, MARGIN_LEFT, y);
    return y + LINE_HEIGHT + 2;
  }

  // Bullet list items
  if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
    doc.setFontSize(FONT_SIZE_BODY);
    const bulletX = MARGIN_LEFT + 5;
    doc.setFont('helvetica', 'normal');
    doc.text('\u2022', MARGIN_LEFT, y); // Bullet character
    const text = trimmedLine.substring(2);
    return renderTextWithFormatting(doc, text, bulletX + 3, y);
  }

  // Regular paragraph with potential formatting
  doc.setFontSize(FONT_SIZE_BODY);
  return renderTextWithFormatting(doc, trimmedLine, MARGIN_LEFT, y);
}

/**
 * Render text with **bold** formatting and word wrap
 */
function renderTextWithFormatting(doc, text, x, y) {
  // Split text into segments based on **bold** markers
  const segments = parseFormattedText(text);

  // Calculate wrapped lines
  const wrappedLines = wrapTextSegments(doc, segments, CONTENT_WIDTH - (x - MARGIN_LEFT));

  for (const lineSegments of wrappedLines) {
    let currentX = x;

    for (const segment of lineSegments) {
      if (segment.bold) {
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setFont('helvetica', 'normal');
      }

      doc.text(segment.text, currentX, y);
      currentX += doc.getTextWidth(segment.text);
    }

    y += LINE_HEIGHT;
  }

  return y;
}

/**
 * Parse text into segments with bold/normal formatting
 */
function parseFormattedText(text) {
  const segments = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldRegex.exec(text)) !== null) {
    // Add text before the bold segment
    if (match.index > lastIndex) {
      segments.push({
        text: text.substring(lastIndex, match.index),
        bold: false,
      });
    }

    // Add the bold segment
    segments.push({
      text: match[1],
      bold: true,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.substring(lastIndex),
      bold: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, bold: false }];
}

/**
 * Wrap text segments to fit within maxWidth
 */
function wrapTextSegments(doc, segments, maxWidth) {
  const lines = [];
  let currentLine = [];
  let currentLineWidth = 0;

  for (const segment of segments) {
    const words = segment.text.split(' ');

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordWithSpace = i > 0 || currentLine.length > 0 ? ' ' + word : word;

      doc.setFont('helvetica', segment.bold ? 'bold' : 'normal');
      const wordWidth = doc.getTextWidth(wordWithSpace);

      if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
        // Start new line
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      }

      // Add word to current line
      const textToAdd = currentLine.length > 0 && i === 0 ? ' ' + word :
                        currentLine.length === 0 ? word : ' ' + word;

      if (currentLine.length > 0 && currentLine[currentLine.length - 1].bold === segment.bold) {
        // Merge with previous segment if same formatting
        currentLine[currentLine.length - 1].text += (i > 0 ? ' ' : '') + word;
      } else {
        currentLine.push({
          text: textToAdd.trimStart(),
          bold: segment.bold,
        });
      }

      currentLineWidth += wordWidth;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Upload PDF blob to Supabase storage
 */
async function uploadPdfToStorage(pdfBlob, filename) {
  const bucket = 'lease-documents';
  const path = `generated/${filename}`;

  // Upload to Supabase storage
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading PDF:', error);
    throw error;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Generate a smart filename for lease agreements
 * Format: "Alpaca Rental Agreement [Name] [Date].pdf"
 */
function generateLeaseFilename(tenantName, date = new Date()) {
  // Clean tenant name for filename (remove special chars, limit length)
  const cleanName = (tenantName || 'Unknown')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .substring(0, 30);

  // Format date as YYYY-MM-DD
  const dateStr = date.toISOString().split('T')[0];

  return `Alpaca Rental Agreement ${cleanName} ${dateStr}.pdf`;
}

/**
 * Generate PDF and upload to storage
 * Returns the public URL of the uploaded PDF
 * @param {string} markdownContent - The markdown content to render
 * @param {string} applicationId - The application ID (used for storage path)
 * @param {Object} options - Optional metadata
 * @param {string} options.tenantName - Tenant name for the filename
 */
async function generateAndUploadLeasePdf(markdownContent, applicationId, options = {}) {
  const displayFilename = generateLeaseFilename(options.tenantName);
  // Storage path uses applicationId for uniqueness, but we return the display filename
  const storagePath = `lease-${applicationId}-${Date.now()}.pdf`;

  // Generate PDF
  const { blob } = await generateLeasePdf(markdownContent, displayFilename);

  // Upload to storage
  const url = await uploadPdfToStorage(blob, storagePath);

  return {
    url,
    filename: displayFilename,
  };
}

/**
 * Download PDF directly (for preview/testing)
 */
async function downloadLeasePdf(markdownContent, filename = 'lease-agreement.pdf') {
  const { doc } = await generateLeasePdf(markdownContent, filename);
  doc.save(filename);
}

export const pdfService = {
  generateLeasePdf,
  generateLeaseFilename,
  uploadPdfToStorage,
  generateAndUploadLeasePdf,
  downloadLeasePdf,
};
