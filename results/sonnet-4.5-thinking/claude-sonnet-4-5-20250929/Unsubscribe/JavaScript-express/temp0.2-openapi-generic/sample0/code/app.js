const express = require('express');
const app = express();

// Middleware to parse text/plain requests
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email from the raw email
function extractEmail(rawEmail) {
  // Look for the From: header
  // Match patterns like:
  // From: email@example.com
  // From: Name <email@example.com>
  const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1];
  }
  return null;
}

// Helper function to check if the email contains unsubscribe keywords
function containsUnsubscribeRequest(rawEmail) {
  const unsubscribeKeywords = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me'
  ];
  
  const emailLower = rawEmail.toLowerCase();
  
  for (const keyword of unsubscribeKeywords) {
    if (emailLower.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;
    
    // Validate input
    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    // Extract email address
    const email = extractEmail(rawEmail);
    
    if (!email) {
      return res.status(400).json({ error: 'Could not extract email address from the message' });
    }
    
    // Check for unsubscribe keywords
    const unsubscribe = containsUnsubscribeRequest(rawEmail);
    
    // Return response
    res.json({
      email: email,
      unsubscribe: unsubscribe
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});