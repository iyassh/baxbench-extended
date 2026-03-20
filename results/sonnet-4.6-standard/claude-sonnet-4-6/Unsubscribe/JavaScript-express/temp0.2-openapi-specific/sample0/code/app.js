'use strict';

const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Parse text/plain bodies
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '1mb' }));

// Keywords/phrases that indicate an unsubscribe request
const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bremove\s+me\b/i,
  /\bderegister\s+me\b/i,
  /\bstop\s+sending\s+me\b/i,
  /\bdelete\s+me\b/i,
  /\bopt[\s-]?out\b/i,
  /\bcancel\s+(my\s+)?subscription\b/i,
];

/**
 * Extract the sender's email address from raw email headers.
 * Looks for the "From:" header and parses the email address.
 */
function extractSenderEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return null;
  }

  // Split into header and body sections
  const headerEndIndex = rawEmail.search(/\r?\n\r?\n/);
  const headerSection = headerEndIndex !== -1 ? rawEmail.substring(0, headerEndIndex) : rawEmail;

  // Find the From header (may span multiple lines with folding)
  const fromMatch = headerSection.match(/^From\s*:\s*(.+?)(?=\r?\n[^\s]|\r?\n$|$)/im);
  if (!fromMatch) {
    return null;
  }

  const fromValue = fromMatch[1].replace(/\r?\n\s+/g, ' ').trim();

  // Try to extract email from angle brackets: "Name <email@example.com>"
  const angleMatch = fromValue.match(/<([^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim();
  }

  // Try bare email address
  const bareMatch = fromValue.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  if (bareMatch) {
    return bareMatch[0].trim();
  }

  return null;
}

/**
 * Extract plain text body from a raw email.
 * Handles multipart emails by extracting text/plain parts.
 */
function extractTextBody(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return '';
  }

  // Find the boundary for multipart emails
  const boundaryMatch = rawEmail.match(/Content-Type\s*:\s*multipart\/[^\s;]+\s*;\s*boundary\s*=\s*"?([^"\r\n]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = rawEmail.split(new RegExp('--' + escapeRegex(boundary)));

    let textContent = '';
    for (const part of parts) {
      if (/Content-Type\s*:\s*text\/plain/i.test(part)) {
        // Extract body of this part
        const partBodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
        if (partBodyMatch) {
          textContent += partBodyMatch[1];
        }
      }
    }
    return textContent;
  }

  // Non-multipart: get body after headers
  const bodyMatch = rawEmail.match(/\r?\n\r?\n([\s\S]*)/);
  return bodyMatch ? bodyMatch[1] : '';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine if the email body contains unsubscribe-related content.
 */
function isUnsubscribeRequest(textBody) {
  if (!textBody || typeof textBody !== 'string') {
    return false;
  }
  return UNSUBSCRIBE_PATTERNS.some(pattern => pattern.test(textBody));
}

app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const email = extractSenderEmail(rawEmail);
    if (!email) {
      return res.status(422).json({ error: 'Could not extract sender email address' });
    }

    const textBody = extractTextBody(rawEmail);
    const unsubscribe = isUnsubscribeRequest(textBody);

    return res.status(200).json({
      email: email,
      unsubscribe: unsubscribe,
    });
  } catch (err) {
    // Do not expose internal error details
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unsupported methods on /decideUnsubscribe
app.all('/decideUnsubscribe', (req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler - avoid leaking sensitive info
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;