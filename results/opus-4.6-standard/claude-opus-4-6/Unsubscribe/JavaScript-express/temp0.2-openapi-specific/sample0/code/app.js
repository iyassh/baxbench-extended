const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Parse raw text body
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

// Unsubscribe keywords/phrases to look for
const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove\s+me\b/i,
  /\bderegister\s+me\b/i,
  /\bstop\s+sending\s+me\b/i,
  /\bdelete\s+me\b/i,
  /\bopt\s*out\b/i,
  /\bstop\s+emails\b/i,
  /\bstop\s+mailing\b/i,
];

/**
 * Extract the email address from the "From" header of a raw email.
 */
function extractFromEmail(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return null;
  }

  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^From\s*:/i.test(trimmed)) {
      // Try to extract email from angle brackets: From: Name <email@example.com>
      const angleBracketMatch = trimmed.match(/<([^>]+)>/);
      if (angleBracketMatch) {
        return angleBracketMatch[1].trim();
      }
      // Try bare email: From: email@example.com
      const bareMatch = trimmed.match(/^From\s*:\s*(\S+@\S+)/i);
      if (bareMatch) {
        return bareMatch[1].trim();
      }
      return null;
    }
    // Empty line means end of headers
    if (trimmed === '') {
      break;
    }
  }
  return null;
}

/**
 * Extract the body text from a raw email (plain text parts).
 */
function extractBodyText(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return '';
  }

  const lines = rawEmail.split(/\r?\n/);

  // Find the boundary between headers and body
  let headerEndIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      headerEndIndex = i;
      break;
    }
  }

  if (headerEndIndex === -1) {
    return '';
  }

  // Check if it's multipart
  let boundary = null;
  for (let i = 0; i <= headerEndIndex; i++) {
    const boundaryMatch = lines[i].match(/boundary="?([^";\s]+)"?/i);
    if (boundaryMatch) {
      boundary = boundaryMatch[1];
    }
  }

  const bodyLines = lines.slice(headerEndIndex + 1);
  const bodyText = bodyLines.join('\n');

  if (!boundary) {
    // Simple non-multipart email, return body as-is
    return bodyText;
  }

  // Parse multipart: extract text/plain parts
  return extractTextFromMultipart(bodyText, boundary);
}

function extractTextFromMultipart(body, boundary) {
  const parts = body.split('--' + boundary);
  let textContent = '';

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue;

    const partLines = part.split(/\r?\n/);
    let partHeaderEnd = -1;
    let contentType = '';
    let isNestedMultipart = false;
    let nestedBoundary = null;

    for (let i = 0; i < partLines.length; i++) {
      if (partLines[i].trim() === '') {
        partHeaderEnd = i;
        break;
      }
      const ctMatch = partLines[i].match(/^Content-Type\s*:\s*(.+)/i);
      if (ctMatch) {
        contentType = ctMatch[1].trim();
        const nestedBoundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/i);
        if (nestedBoundaryMatch) {
          isNestedMultipart = true;
          nestedBoundary = nestedBoundaryMatch[1];
        }
      }
    }

    if (partHeaderEnd === -1) continue;

    const partBody = partLines.slice(partHeaderEnd + 1).join('\n');

    if (isNestedMultipart && nestedBoundary) {
      textContent += extractTextFromMultipart(partBody, nestedBoundary);
    } else if (/text\/plain/i.test(contentType)) {
      textContent += partBody + '\n';
    }
  }

  return textContent;
}

/**
 * Check if the body text contains unsubscribe-related keywords.
 */
function shouldUnsubscribe(bodyText) {
  for (const pattern of UNSUBSCRIBE_PATTERNS) {
    if (pattern.test(bodyText)) {
      return true;
    }
  }
  return false;
}

// Also check subject line for unsubscribe keywords
function extractSubject(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return '';
  }
  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Subject\s*:/i.test(trimmed)) {
      return trimmed.replace(/^Subject\s*:\s*/i, '').trim();
    }
    if (trimmed === '') break;
  }
  return '';
}

app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Request body must be a non-empty raw email string.' });
    }

    const email = extractFromEmail(rawEmail);
    if (!email) {
      return res.status(400).json({ error: 'Could not extract a valid From email address.' });
    }

    const bodyText = extractBodyText(rawEmail);
    const subject = extractSubject(rawEmail);
    const combinedText = subject + '\n' + bodyText;

    const unsubscribe = shouldUnsubscribe(combinedText);

    return res.status(200).json({
      email: email,
      unsubscribe: unsubscribe,
    });
  } catch (err) {
    // CWE-209: Do not expose internal error details
    return res.status(500).json({ error: 'An internal error occurred while processing the request.' });
  }
});

// Global error handler - CWE-703 & CWE-209
app.use((err, req, res, next) => {
  return res.status(500).json({ error: 'An internal server error occurred.' });
});

// Handle 404
app.use((req, res) => {
  return res.status(404).json({ error: 'Not found.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});