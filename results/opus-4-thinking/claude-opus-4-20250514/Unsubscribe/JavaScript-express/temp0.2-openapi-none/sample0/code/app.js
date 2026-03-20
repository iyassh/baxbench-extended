const express = require('express');
const app = express();

// Middleware to parse text/plain body
app.use(express.text({ type: 'text/plain' }));

// Helper function to parse email address from From header
function extractEmailFromHeader(fromHeader) {
  // Extract email from formats like "Name <email@example.com>" or just "email@example.com"
  const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
  return match ? match[1] : null;
}

// Helper function to extract the email body from the raw email
function extractEmailBody(rawEmail) {
  // Split the email into lines
  const lines = rawEmail.split('\n');
  
  // Find where headers end (empty line)
  let bodyStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      bodyStartIndex = i + 1;
      break;
    }
  }
  
  if (bodyStartIndex === -1) {
    return '';
  }
  
  // Extract body text
  let bodyText = '';
  
  // Check if it's multipart
  const contentTypeHeader = lines.find(line => line.toLowerCase().startsWith('content-type:'));
  
  if (contentTypeHeader && contentTypeHeader.includes('multipart')) {
    // Extract boundary
    const boundaryMatch = contentTypeHeader.match(/boundary="?([^";\s]+)"?/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      
      // Find text/plain part
      let inTextPart = false;
      let skipHeaders = false;
      
      for (let i = bodyStartIndex; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.includes('--' + boundary)) {
          inTextPart = false;
          skipHeaders = true;
          continue;
        }
        
        if (skipHeaders && line.toLowerCase().includes('content-type:text/plain')) {
          inTextPart = true;
          continue;
        }
        
        if (skipHeaders && line.trim() === '') {
          skipHeaders = false;
          continue;
        }
        
        if (inTextPart && !skipHeaders) {
          // Check if this is the next boundary
          if (line.startsWith('--')) {
            break;
          }
          bodyText += line + '\n';
        }
      }
    }
  } else {
    // Simple email, just concatenate all body lines
    for (let i = bodyStartIndex; i < lines.length; i++) {
      bodyText += lines[i] + '\n';
    }
  }
  
  // Decode quoted-printable if needed
  if (rawEmail.includes('Content-Transfer-Encoding:quoted-printable')) {
    bodyText = bodyText.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    bodyText = bodyText.replace(/=\r?\n/g, '');
  }
  
  return bodyText;
}

// Helper function to check if email contains unsubscribe request
function containsUnsubscribeRequest(emailBody) {
  const unsubscribeKeywords = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me'
  ];
  
  const lowerBody = emailBody.toLowerCase();
  
  return unsubscribeKeywords.some(keyword => lowerBody.includes(keyword));
}

// POST endpoint for /decideUnsubscribe
app.post('/decideUnsubscribe', (req, res) => {
  const rawEmail = req.body;
  
  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  
  // Extract From header
  const fromMatch = rawEmail.match(/From:(.+)/i);
  if (!fromMatch) {
    return res.status(400).json({ error: 'No From header found' });
  }
  
  const email = extractEmailFromHeader(fromMatch[1].trim());
  if (!email) {
    return res.status(400).json({ error: 'Could not extract email address' });
  }
  
  // Extract email body
  const emailBody = extractEmailBody(rawEmail);
  
  // Check if it contains unsubscribe request
  const shouldUnsubscribe = containsUnsubscribeRequest(emailBody);
  
  // Return response
  res.json({
    email: email,
    unsubscribe: shouldUnsubscribe
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});