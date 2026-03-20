const express = require('express');
const app = express();

// Middleware to parse text/plain as text
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email from raw email content
function extractEmail(rawEmail) {
  // Look for From: header
  const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1];
  }
  return null;
}

// Helper function to check if email contains unsubscribe keywords
function containsUnsubscribeRequest(rawEmail) {
  const lowerEmail = rawEmail.toLowerCase();
  
  // Keywords and phrases that indicate unsubscribe request
  const unsubscribeKeywords = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me',
    'opt out',
    'opt-out',
    'take me off',
    'remove from list',
    'cancel subscription',
    'stop emails',
    'no longer wish to receive'
  ];
  
  // Check if any keyword is present in the email
  for (const keyword of unsubscribeKeywords) {
    if (lowerEmail.includes(keyword)) {
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
      return res.status(400).json({ error: 'Invalid request body. Expected text/plain content.' });
    }
    
    // Extract email address
    const email = extractEmail(rawEmail);
    
    // Check if unsubscribe request
    const unsubscribe = containsUnsubscribeRequest(rawEmail);
    
    // Return response
    res.status(200).json({
      email: email,
      unsubscribe: unsubscribe
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});