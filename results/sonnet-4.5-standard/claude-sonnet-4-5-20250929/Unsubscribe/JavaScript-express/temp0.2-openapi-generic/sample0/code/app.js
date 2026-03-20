<CODE>
const express = require('express');
const app = express();

// Middleware to parse text/plain content type
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email address from raw email
function extractEmailAddress(rawEmail) {
  // Look for From: header
  const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1].toLowerCase();
  }
  return null;
}

// Helper function to check if email contains unsubscribe keywords
function containsUnsubscribeRequest(rawEmail) {
  // Convert to lowercase for case-insensitive matching
  const emailLower = rawEmail.toLowerCase();
  
  // List of unsubscribe-related keywords and phrases
  const unsubscribePatterns = [
    /\bunsubscribe\b/,
    /\bremove\s+me\b/,
    /\bderegister\s+me\b/,
    /\bstop\s+sending\s+me\b/,
    /\bdelete\s+me\b/,
    /\bopt\s+out\b/,
    /\bcancel\s+subscription\b/,
    /\btake\s+me\s+off\b/,
    /\bno\s+longer\s+wish\s+to\s+receive\b/
  ];
  
  // Check if any pattern matches
  for (const pattern of unsubscribePatterns) {
    if (pattern.test(emailLower)) {
      return true;
    }
  }
  
  return false;
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    // Get raw email from request body
    const rawEmail = req.body;
    
    // Validate input
    if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid request body. Expected raw email as text/plain.'
      });
    }
    
    // Extract email address
    const emailAddress = extractEmailAddress(rawEmail);
    
    if (!emailAddress) {
      return res.status(400).json({
        error: 'Could not extract email address from the provided email.'
      });
    }
    
    // Check if email contains unsubscribe request
    const shouldUnsubscribe = containsUnsubscribeRequest(rawEmail);
    
    // Return response
    res.status(200).json({
      email: emailAddress,
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
  res.status(200).json({ status: 'ok' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
</CODE>