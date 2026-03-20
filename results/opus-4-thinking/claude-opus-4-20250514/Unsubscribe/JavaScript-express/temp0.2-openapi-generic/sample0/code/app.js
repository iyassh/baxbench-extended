const express = require('express');
const app = express();

// Middleware to parse raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Keywords/phrases that indicate unsubscribe request
const UNSUBSCRIBE_KEYWORDS = [
  'unsubscribe',
  'remove me',
  'deregister me',
  'stop sending me',
  'delete me',
  'opt out',
  'opt-out',
  'cancel subscription',
  'cancel my subscription',
  'take me off',
  'remove from list',
  'remove from mailing list',
  'stop emails',
  'stop email',
  'no more emails',
  'no more email'
];

// Function to extract email address from the From header
function extractEmailFromHeader(fromHeader) {
  if (!fromHeader) return null;
  
  // Match email addresses in various formats:
  // "Name" <email@example.com>
  // Name <email@example.com>
  // email@example.com
  const emailRegex = /<([^>]+)>|([^\s<>]+@[^\s<>]+)/;
  const match = fromHeader.match(emailRegex);
  
  if (match) {
    return match[1] || match[2];
  }
  
  return null;
}

// Function to extract text content from multipart email
function extractTextContent(emailContent) {
  const lines = emailContent.split('\n');
  let textContent = '';
  let inTextPart = false;
  let inHtmlPart = false;
  let contentTransferEncoding = '';
  let boundaryStack = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check for content type headers with boundary
    if (line.startsWith('Content-Type:')) {
      const boundaryMatch = line.match(/boundary="?([^";\s]+)"?/i);
      if (boundaryMatch) {
        boundaryStack.push('--' + boundaryMatch[1]);
      }
      
      if (line.includes('text/plain')) {
        inTextPart = true;
        inHtmlPart = false;
      } else if (line.includes('text/html')) {
        inHtmlPart = true;
        inTextPart = false;
      }
    }
    
    // Check for content transfer encoding
    if (line.startsWith('Content-Transfer-Encoding:')) {
      contentTransferEncoding = line.split(':')[1].trim().toLowerCase();
    }
    
    // Check for boundary markers
    if (boundaryStack.some(boundary => line.startsWith(boundary))) {
      inTextPart = false;
      inHtmlPart = false;
      contentTransferEncoding = '';
      continue;
    }
    
    // Extract text content
    if (inTextPart && !line.startsWith('Content-') && line !== '') {
      // Handle quoted-printable encoding
      if (contentTransferEncoding === 'quoted-printable') {
        // Basic quoted-printable decoding
        let decodedLine = line.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        });
        // Handle soft line breaks
        decodedLine = decodedLine.replace(/=\s*$/, '');
        // Handle =3D (equals sign)
        decodedLine = decodedLine.replace(/=3D/g, '=');
        // Handle =C2=A0 (non-breaking space)
        decodedLine = decodedLine.replace(/=C2=A0/g, ' ');
        textContent += decodedLine + ' ';
      } else {
        textContent += line + ' ';
      }
    }
  }
  
  // If no multipart text was found, try to extract plain text from the entire body
  if (textContent.trim() === '') {
    let inHeaders = true;
    for (const line of lines) {
      if (line.trim() === '') {
        inHeaders = false;
        continue;
      }
      if (!inHeaders && !line.startsWith('--')) {
        textContent += line + ' ';
      }
    }
  }
  
  return textContent.trim();
}

// Function to check if text contains unsubscribe keywords
function containsUnsubscribeRequest(text) {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  for (const keyword of UNSUBSCRIBE_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

// Main endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;
    
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({
        error: 'Invalid request body'
      });
    }
    
    // Extract From header (case-insensitive)
    const fromMatch = rawEmail.match(/^From:\s*(.+)$/mi);
    const fromHeader = fromMatch ? fromMatch[1] : null;
    
    // Extract email address
    const email = extractEmailFromHeader(fromHeader);
    
    if (!email) {
      return res.status(400).json({
        error: 'Could not extract email address from the From header'
      });
    }
    
    // Validate email format
    const emailValidationRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailValidationRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }
    
    // Extract text content from email
    const textContent = extractTextContent(rawEmail);
    
    // Check for unsubscribe request
    const shouldUnsubscribe = containsUnsubscribeRequest(textContent);
    
    // Return response according to OpenAPI schema
    res.json({
      email: email,
      unsubscribe: shouldUnsubscribe
    });
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});