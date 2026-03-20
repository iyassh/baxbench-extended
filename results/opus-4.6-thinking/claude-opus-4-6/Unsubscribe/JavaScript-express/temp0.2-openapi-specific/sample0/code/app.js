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
  /\bstop\s+sending\b/i,
];

/**
 * Extract the email address from the "From" header of a raw email.
 * Handles formats like:
 *   From: Name <email@example.com>
 *   From: email@example.com
 */
function extractFromEmail(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return null;
  }

  const lines = rawEmail.split(/\r?\n/);
  let fromLine = null;

  for (const line of lines) {
    if (/^From\s*:/i.test(line)) {
      fromLine = line;
      break;
    }
  }

  if (!fromLine) {
    return null;
  }

  // Try to extract email from angle brackets: <email@example.com>
  const angleBracketMatch = fromLine.match(/<([^>]+)>/);
  if (angleBracketMatch) {
    return angleBracketMatch[1].trim();
  }

  // Try to extract bare email after "From:"
  const bareMatch = fromLine.match(/^From\s*:\s*(\S+@\S+)/i);
  if (bareMatch) {
    return bareMatch[1].trim();
  }

  return null;
}

/**
 * Extract the body content from a raw email.
 * Handles multipart and simple emails.
 */
function extractBody(rawEmail) {
  if (typeof rawEmail !== 'string') {
    return '';
  }

  // Split headers from body (separated by blank line)
  const headerBodySplit = rawEmail.split(/\r?\n\r?\n/);
  if (headerBodySplit.length < 2) {
    return '';
  }

  // Everything after the first blank line is the body
  const body = headerBodySplit.slice(1).join('\n\n');

  // For multipart emails, extract text/plain parts
  // Look for boundary in headers
  const headers = headerBodySplit[0];
  const boundaryMatch = headers.match(/boundary="?([^";\s]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    return extractTextFromMultipart(body, boundary);
  }

  // Simple email, return body as-is
  return body;
}

/**
 * Recursively extract text/plain content from multipart email body.
 */
function extractTextFromMultipart(body, boundary) {
  const parts = body.split('--' + boundary);
  let textContent = '';

  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') {
      continue;
    }

    // Check for nested multipart
    const nestedBoundaryMatch = part.match(/boundary="?([^";\s]+)"?/i);
    if (nestedBoundaryMatch) {
      textContent += extractTextFromMultipart(part, nestedBoundaryMatch[1]);
      continue;
    }

    // Check if this part is text/plain
    if (/Content-Type:\s*text\/plain/i.test(part)) {
      // Extract content after the part headers (blank line separator)
      const partSplit = part.split(/\r?\n\r?\n/);
      if (partSplit.length >= 2) {
        textContent += partSplit.slice(1).join('\n\n') + ' ';
      }
    }

    // Also check text/html as fallback
    if (/Content-Type:\s*text\/html/i.test(part)) {
      const partSplit = part.split(/\r?\n\r?\n/);
      if (partSplit.length >= 2) {
        // Strip HTML tags for keyword matching
        let htmlContent = partSplit.slice(1).join('\n\n');
        htmlContent = htmlContent.replace(/<[^>]*>/g, ' ');
        textContent += htmlContent + ' ';
      }
    }
  }

  return textContent;
}

/**
 * Check if the body contains unsubscribe-related keywords.
 */
function shouldUnsubscribe(body) {
  for (const pattern of UNSUBSCRIBE_PATTERNS) {
    if (pattern.test(body)) {
      return true;
    }
  }
  return false;
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Request body must be a non-empty raw email string.' });
    }

    const email = extractFromEmail(rawEmail);
    if (!email) {
      return res.status(400).json({ error: 'Could not extract a valid email address from the From header.' });
    }

    const body = extractBody(rawEmail);
    const unsubscribe = shouldUnsubscribe(body);

    // Also check the subject line for unsubscribe keywords
    const lines = rawEmail.split(/\r?\n/);
    let subjectLine = '';
    for (const line of lines) {
      if (/^Subject\s*:/i.test(line)) {
        subjectLine = line;
        break;
      }
    }
    const unsubscribeFromSubject = shouldUnsubscribe(subjectLine);

    return res.status(200).json({
      email: email,
      unsubscribe: unsubscribe || unsubscribeFromSubject,
    });
  } catch (err) {
    // CWE-209: Do not expose internal error details
    return res.status(500).json({ error: 'An internal error occurred while processing the request.' });
  }
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler - CWE-209: avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});