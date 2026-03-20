'use strict';

const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Parse text/plain bodies
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '1mb' }));

/**
 * Extract the sender's email address from raw email headers.
 * Looks for the "From:" header and parses the email address.
 */
function extractSenderEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return null;
  }

  // Split into lines and find the From header
  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    // Match "From:" header (case-insensitive)
    const match = line.match(/^From\s*:\s*(.+)$/i);
    if (match) {
      const fromValue = match[1].trim();
      // Try to extract email from "Name <email>" format
      const angleMatch = fromValue.match(/<([^>]+)>/);
      if (angleMatch) {
        return angleMatch[1].trim().toLowerCase();
      }
      // Try bare email address
      const bareMatch = fromValue.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
      if (bareMatch) {
        return bareMatch[0].trim().toLowerCase();
      }
    }
  }
  return null;
}

/**
 * Extract the plain text body from a raw email.
 * Handles multipart emails by finding text/plain parts.
 */
function extractEmailBody(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return '';
  }

  // Try to find multipart boundary
  const boundaryMatch = rawEmail.match(/boundary\s*=\s*"?([^"\s;]+)"?/i);
  
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split(new RegExp('--' + escapeRegex(boundary)));
    
    let textContent = '';
    for (const part of parts) {
      // Check if this part is text/plain
      if (/Content-Type\s*:\s*text\/plain/i.test(part)) {
        // Extract body after the headers (double newline)
        const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
        if (bodyMatch) {
          textContent += decodeQuotedPrintable(bodyMatch[1]);
        }
      }
    }
    if (textContent) {
      return textContent;
    }
  }

  // Fallback: extract body after headers
  const headerBodySplit = rawEmail.match(/\r?\n\r?\n([\s\S]*)/);
  if (headerBodySplit) {
    return decodeQuotedPrintable(headerBodySplit[1]);
  }

  return rawEmail;
}

/**
 * Decode quoted-printable encoding.
 */
function decodeQuotedPrintable(str) {
  if (!str) return '';
  return str
    .replace(/=\r?\n/g, '') // soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine if the email body contains an unsubscribe request.
 */
function isUnsubscribeRequest(body) {
  if (!body || typeof body !== 'string') {
    return false;
  }

  const lowerBody = body.toLowerCase();

  const unsubscribePatterns = [
    /unsubscribe/i,
    /remove\s+me/i,
    /deregister\s+me/i,
    /stop\s+sending\s+me/i,
    /delete\s+me/i,
    /opt[\s-]*out/i,
    /take\s+me\s+off/i,
    /cancel\s+(my\s+)?subscription/i,
  ];

  for (const pattern of unsubscribePatterns) {
    if (pattern.test(lowerBody)) {
      return true;
    }
  }

  return false;
}

app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid request: email body is required' });
    }

    const senderEmail = extractSenderEmail(rawEmail);
    const emailBody = extractEmailBody(rawEmail);
    const unsubscribe = isUnsubscribeRequest(emailBody);

    return res.status(200).json({
      email: senderEmail || '',
      unsubscribe: unsubscribe,
    });
  } catch (err) {
    // Avoid leaking sensitive error details (CWE-209)
    return res.status(500).json({ error: 'An internal server error occurred' });
  }
});

// Handle unsupported methods on the endpoint
app.all('/decideUnsubscribe', (req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal server error occurred' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;