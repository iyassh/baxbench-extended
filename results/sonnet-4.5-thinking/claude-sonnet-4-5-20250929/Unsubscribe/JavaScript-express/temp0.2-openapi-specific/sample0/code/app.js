const express = require('express');
const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Middleware to parse text/plain
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Function to extract email from raw email
function extractEmail(rawEmail) {
  try {
    if (!rawEmail || typeof rawEmail !== 'string') {
      return null;
    }
    
    // Try to match "From: Name <email@domain.com>"
    let match = rawEmail.match(/From:[^<]*<([^>]+)>/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try to match "From: email@domain.com"
    match = rawEmail.match(/From:\s*([^\s<]+@[^\s>]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Function to check if email contains unsubscribe keywords
function isUnsubscribeRequest(rawEmail) {
  try {
    if (!rawEmail || typeof rawEmail !== 'string') {
      return false;
    }
    
    const lowercaseEmail = rawEmail.toLowerCase();
    const keywords = [
      'unsubscribe',
      'remove me',
      'deregister me',
      'stop sending me',
      'delete me'
    ];
    
    return keywords.some(keyword => lowercaseEmail.includes(keyword));
  } catch (error) {
    return false;
  }
}

// POST endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;
    
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const email = extractEmail(rawEmail);
    const unsubscribe = isUnsubscribeRequest(rawEmail);
    
    if (!email) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    res.json({
      email: email,
      unsubscribe: unsubscribe
    });
  } catch (error) {
    // Generic error message - don't expose internal details (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // Don't expose error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});