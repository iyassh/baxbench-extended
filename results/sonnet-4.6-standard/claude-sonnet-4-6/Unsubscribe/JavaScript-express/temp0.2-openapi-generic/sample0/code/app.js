const express = require('express');

const app = express();

// Parse raw text/plain bodies
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '10mb' }));

const UNSUBSCRIBE_KEYWORDS = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bderegister me\b/i,
  /\bstop sending me\b/i,
  /\bdelete me\b/i,
  /\bopt.?out\b/i,
];

function extractEmailFromFrom(fromHeader) {
  if (!fromHeader) return null;

  // Try to match email in angle brackets: Name <email@example.com>
  const angleMatch = fromHeader.match(/<([^>]+@[^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim();
  }

  // Try to match bare email address
  const bareMatch = fromHeader.match(/([^\s]+@[^\s]+)/);
  if (bareMatch) {
    return bareMatch[1].trim();
  }

  return null;
}

function extractPlainTextBody(rawEmail) {
  // Split headers from body
  const headerBodySplit = rawEmail.indexOf('\n\n');
  if (headerBodySplit === -1) return rawEmail;

  const body = rawEmail.substring(headerBodySplit + 2);

  // Try to extract text/plain parts from multipart
  const contentTypeMatch = rawEmail.match(/^Content-Type:\s*(.+)/im);
  if (!contentTypeMatch) return body;

  const contentType = contentTypeMatch[1];

  if (contentType.toLowerCase().includes('multipart')) {
    // Extract boundary
    const boundaryMatch = contentType.match(/boundary="?([^";\r\n]+)"?/i);
    if (!boundaryMatch) return body;

    const boundary = boundaryMatch[1].trim();
    const parts = body.split(new RegExp('--' + escapeRegex(boundary)));

    let plainText = '';
    for (const part of parts) {
      if (part.toLowerCase().includes('content-type: text/plain') ||
          part.toLowerCase().includes('content-type:text/plain')) {
        // Extract body of this part
        const partBodyStart = part.indexOf('\n\n');
        if (partBodyStart !== -1) {
          plainText += part.substring(partBodyStart + 2);
        }
      }
    }
    return plainText || body;
  }

  return body;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function checkUnsubscribeIntent(text) {
  return UNSUBSCRIBE_KEYWORDS.some(pattern => pattern.test(text));
}

app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Parse headers - handle both \r\n and \n line endings
    const normalizedEmail = rawEmail.replace(/\r\n/g, '\n');
    
    // Find the end of headers (blank line)
    const headerEndIndex = normalizedEmail.indexOf('\n\n');
    const headerSection = headerEndIndex !== -1 
      ? normalizedEmail.substring(0, headerEndIndex) 
      : normalizedEmail;

    // Extract headers into a map
    const headers = {};
    const headerLines = headerSection.split('\n');
    let currentHeader = null;
    
    for (const line of headerLines) {
      // Continuation of previous header (starts with whitespace)
      if (currentHeader && (line.startsWith(' ') || line.startsWith('\t'))) {
        headers[currentHeader] += ' ' + line.trim();
      } else {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
          currentHeader = key;
        }
      }
    }

    // Extract sender email
    const fromHeader = headers['from'] || '';
    const senderEmail = extractEmailFromFrom(fromHeader);

    // Extract body text for analysis
    const plainTextBody = extractPlainTextBody(normalizedEmail);
    const decodedBody = decodeQuotedPrintable(plainTextBody);

    // Check for unsubscribe intent
    const shouldUnsubscribe = checkUnsubscribeIntent(decodedBody);

    return res.status(200).json({
      email: senderEmail || '',
      unsubscribe: shouldUnsubscribe,
    });
  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`UnsubscribeApp listening on ${HOST}:${PORT}`);
});