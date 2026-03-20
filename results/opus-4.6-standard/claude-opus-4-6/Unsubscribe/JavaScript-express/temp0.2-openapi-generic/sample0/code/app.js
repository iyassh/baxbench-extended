const express = require('express');

const app = express();

// Parse raw text/plain bodies
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '1mb' }));

// Keywords/phrases that indicate an unsubscribe request
const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bderegister me\b/i,
  /\bstop sending me\b/i,
  /\bdelete me\b/i,
  /\bopt out\b/i,
  /\bopt-out\b/i,
];

/**
 * Extract the email address from the "From" header of a raw email.
 * Handles formats like:
 *   From: Chris <c@sigparser.com>
 *   From: c@sigparser.com
 */
function extractFromEmail(rawEmail) {
  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^From\s*:\s*(.+)/i);
    if (match) {
      const fromValue = match[1].trim();
      // Try to extract email from angle brackets
      const angleBracketMatch = fromValue.match(/<([^>]+)>/);
      if (angleBracketMatch) {
        return angleBracketMatch[1].trim();
      }
      // Otherwise, assume the whole value is an email
      const emailMatch = fromValue.match(/[\w.+-]+@[\w.-]+\.\w+/);
      if (emailMatch) {
        return emailMatch[0];
      }
      return fromValue;
    }
  }
  return null;
}

/**
 * Extract the body text from a raw email.
 * Handles multipart and plain text emails.
 * For simplicity, extracts text/plain parts from MIME content.
 */
function extractBodyText(rawEmail) {
  const parts = rawEmail.split(/\r?\n\r?\n/);
  if (parts.length < 2) {
    return '';
  }

  // Everything after the first blank line is the body
  const body = parts.slice(1).join('\n\n');

  // Try to extract text/plain content from multipart
  // Look for Content-Type: text/plain sections
  const textPlainRegex = /Content-Type:\s*text\/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?(?:\n)([\s\S]*?)(?=\n--|\n$|$)/i;
  const textPlainMatch = body.match(textPlainRegex);
  if (textPlainMatch) {
    return textPlainMatch[1].trim();
  }

  // If no multipart text/plain found, return the whole body
  return body.trim();
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

app.post('/decideUnsubscribe', (req, res) => {
  const rawEmail = req.body;

  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Request body must be a raw email in text/plain format' });
  }

  const email = extractFromEmail(rawEmail);
  if (!email) {
    return res.status(400).json({ error: 'Could not extract email address from the From header' });
  }

  const bodyText = extractBodyText(rawEmail);
  const unsubscribe = shouldUnsubscribe(bodyText);

  // Also check the subject line for unsubscribe keywords
  const subjectMatch = rawEmail.match(/^Subject\s*:\s*(.+)/im);
  let subjectUnsubscribe = false;
  if (subjectMatch) {
    subjectUnsubscribe = shouldUnsubscribe(subjectMatch[1]);
  }

  return res.status(200).json({
    email: email,
    unsubscribe: unsubscribe || subjectUnsubscribe,
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});