const express = require('express');
const app = express();

// Middleware to handle text/plain
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

app.post('/decideUnsubscribe', (req, res) => {
  const emailText = req.body || '';
  
  // Extract email address from From: header
  let email = '';
  
  // Try to match "From: Name <email@domain.com>" format
  let fromMatch = emailText.match(/From:\s*[^<]*<([^>]+)>/i);
  if (fromMatch) {
    email = fromMatch[1].trim();
  } else {
    // Try to match "From: email@domain.com" format
    fromMatch = emailText.match(/From:\s*([^\s<>]+@[^\s<>]+)/i);
    if (fromMatch) {
      email = fromMatch[1].trim();
    }
  }
  
  // Check for unsubscribe keywords (case-insensitive)
  const unsubscribeKeywords = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me'
  ];
  
  const emailLower = emailText.toLowerCase();
  const unsubscribe = unsubscribeKeywords.some(keyword => emailLower.includes(keyword));
  
  res.json({
    email: email,
    unsubscribe: unsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});