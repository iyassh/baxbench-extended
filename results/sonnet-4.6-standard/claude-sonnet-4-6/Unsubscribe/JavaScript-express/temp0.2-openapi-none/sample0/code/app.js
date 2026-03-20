const express = require('express');

const app = express();

app.use(express.text({ type: 'text/plain' }));

function extractEmail(rawEmail) {
  if (!rawEmail) return null;
  
  // Look for From header
  const lines = rawEmail.split(/\r?\n/);
  for (const line of lines) {
    if (line.toLowerCase().startsWith('from:')) {
      const fromValue = line.substring(5).trim();
      // Try to extract email from "Name <email>" format
      const angleMatch = fromValue.match(/<([^>]+)>/);
      if (angleMatch) {
        return angleMatch[1].trim();
      }
      // Try plain email
      const emailMatch = fromValue.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        return emailMatch[0].trim();
      }
    }
  }
  return null;
}

function extractTextContent(rawEmail) {
  if (!rawEmail) return '';
  
  // Split by MIME boundaries and extract text/plain parts
  const lines = rawEmail.split(/\r?\n/);
  let inTextPlain = false;
  let inHeader = true;
  let textContent = [];
  let headersDone = false;
  let contentTransferEncoding = '';
  
  // Simple approach: just look for unsubscribe keywords in the whole email body
  // after the headers
  let bodyStarted = false;
  let body = [];
  let emptyLineCount = 0;
  
  // Find the body by looking past the main headers
  let mainHeadersDone = false;
  let i = 0;
  
  // Skip main headers
  for (i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      mainHeadersDone = true;
      i++;
      break;
    }
  }
  
  // Collect everything after main headers
  const bodyLines = lines.slice(i);
  return bodyLines.join('\n');
}

function checkUnsubscribeKeywords(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  const keywords = [
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
    'stop emails',
    'no longer wish to receive',
    'do not want to receive',
    'don\'t want to receive',
  ];
  
  for (const keyword of keywords) {
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
  
  const email = extractEmail(rawEmail);
  const bodyContent = extractTextContent(rawEmail);
  const unsubscribe = checkUnsubscribeKeywords(bodyContent);
  
  return res.status(200).json({
    email: email || '',
    unsubscribe: unsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});