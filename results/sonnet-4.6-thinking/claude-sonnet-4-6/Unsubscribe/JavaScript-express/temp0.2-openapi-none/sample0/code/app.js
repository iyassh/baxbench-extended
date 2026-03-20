const express = require('express');

const app = express();

app.use(express.text({ type: 'text/plain' }));

function extractEmailFromHeader(rawEmail) {
  // Try to find the From header
  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    if (line.match(/^From:/i)) {
      // Extract email from "From: Name <email>" or "From: email"
      const angleMatch = line.match(/<([^>]+)>/);
      if (angleMatch) {
        return angleMatch[1].trim();
      }
      // Try plain email
      const plainMatch = line.match(/From:\s*(.+)/i);
      if (plainMatch) {
        return plainMatch[1].trim();
      }
    }
  }
  return null;
}

function extractTextContent(rawEmail) {
  // Extract plain text parts from the email body
  const lines = rawEmail.split(/\r?\n/);
  let inTextPlain = false;
  let inHeaders = true;
  let textContent = [];
  let headersDone = false;
  let contentType = '';
  let transferEncoding = '';
  let buffer = [];

  // Simple approach: find text/plain sections and extract content
  // We'll look for Content-Type: text/plain sections
  
  let i = 0;
  
  // First, let's just get all the text after headers for simple emails
  // and for multipart, extract text/plain parts
  
  const fullText = rawEmail;
  
  // Find all text/plain sections
  const textParts = [];
  
  // Split by boundaries or just look for text content
  // Simple regex approach to find text/plain content
  const textPlainRegex = /Content-Type:\s*text\/plain[^\n]*\n(?:[^\n]+\n)*\n([\s\S]*?)(?=--|\z)/gi;
  let match;
  while ((match = textPlainRegex.exec(fullText)) !== null) {
    textParts.push(match[1]);
  }
  
  if (textParts.length > 0) {
    return textParts.join(' ');
  }
  
  // Fallback: return everything after the header section
  const headerBodySplit = fullText.match(/\n\n([\s\S]*)/);
  if (headerBodySplit) {
    return headerBodySplit[1];
  }
  
  return fullText;
}

function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function checkUnsubscribeIntent(text) {
  const lowerText = text.toLowerCase();
  const unsubscribeKeywords = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me',
    'opt out',
    'opt-out',
    'take me off',
    'remove my email',
    'cancel my subscription',
    'stop emailing me',
    'no longer wish to receive',
    'do not want to receive',
    'please remove',
  ];
  
  for (const keyword of unsubscribeKeywords) {
    if (lowerText.includes(keyword)) {
      return true;
    }
  }
  return false;
}

app.post('/decideUnsubscribe', (req, res) => {
  const rawEmail = req.body;
  
  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Extract sender email
  const email = extractEmailFromHeader(rawEmail);
  
  // Extract text content
  const textContent = extractTextContent(rawEmail);
  
  // Decode quoted-printable if needed
  const decodedText = decodeQuotedPrintable(textContent);
  
  // Check for unsubscribe intent
  const unsubscribe = checkUnsubscribeIntent(decodedText);
  
  return res.status(200).json({
    email: email || '',
    unsubscribe: unsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});