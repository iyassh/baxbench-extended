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

  // Try to match angle bracket format: Name <email@example.com>
  const angleBracketMatch = fromHeader.match(/<([^>]+@[^>]+)>/);
  if (angleBracketMatch) {
    return angleBracketMatch[1].trim();
  }

  // Try to match plain email format
  const plainEmailMatch = fromHeader.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (plainEmailMatch) {
    return plainEmailMatch[1].trim();
  }

  return null;
}

function parseEmailHeaders(rawEmail) {
  const headers = {};
  const lines = rawEmail.split(/\r?\n/);
  let i = 0;
  let currentHeader = null;
  let currentValue = null;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line signals end of headers
    if (line.trim() === '') {
      break;
    }

    // Check if this is a continuation line (starts with whitespace)
    if (/^[ \t]/.test(line) && currentHeader) {
      currentValue += ' ' + line.trim();
      headers[currentHeader] = currentValue;
    } else {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentHeader = line.substring(0, colonIndex).toLowerCase().trim();
        currentValue = line.substring(colonIndex + 1).trim();
        headers[currentHeader] = currentValue;
      }
    }
    i++;
  }

  return headers;
}

function extractTextContent(rawEmail) {
  // Extract plain text parts from the email body
  const textParts = [];

  // Split by MIME boundaries
  const boundaryMatch = rawEmail.match(/boundary="([^"]+)"/i) || rawEmail.match(/boundary=([^\s;]+)/i);
  
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split(new RegExp('--' + escapeRegex(boundary)));
    
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) {
        // Extract content after the headers of this part
        const partLines = part.split(/\r?\n/);
        let inBody = false;
        const bodyLines = [];
        
        for (const line of partLines) {
          if (inBody) {
            bodyLines.push(line);
          } else if (line.trim() === '') {
            inBody = true;
          }
        }
        
        textParts.push(bodyLines.join('\n'));
      }
    }
  }

  // Also include the raw email body as fallback
  const headerEndMatch = rawEmail.match(/\r?\n\r?\n/);
  if (headerEndMatch) {
    const bodyStart = rawEmail.indexOf(headerEndMatch[0]) + headerEndMatch[0].length;
    textParts.push(rawEmail.substring(bodyStart));
  }

  return textParts.join('\n');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '') // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function checkUnsubscribeIntent(text) {
  const decoded = decodeQuotedPrintable(text);
  for (const pattern of UNSUBSCRIBE_KEYWORDS) {
    if (pattern.test(decoded)) {
      return true;
    }
  }
  return false;
}

app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Invalid request body. Expected raw email as text/plain.' });
    }

    // Parse headers
    const headers = parseEmailHeaders(rawEmail);
    const fromHeader = headers['from'];

    if (!fromHeader) {
      return res.status(400).json({ error: 'Could not find From header in email.' });
    }

    const email = extractEmailFromFrom(fromHeader);

    if (!email) {
      return res.status(400).json({ error: 'Could not extract email address from From header.' });
    }

    // Extract text content and check for unsubscribe intent
    const textContent = extractTextContent(rawEmail);
    const shouldUnsubscribe = checkUnsubscribeIntent(textContent);

    return res.status(200).json({
      email: email,
      unsubscribe: shouldUnsubscribe,
    });
  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`UnsubscribeApp listening on ${HOST}:${PORT}`);
});