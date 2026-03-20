const express = require('express');
const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Middleware to parse raw text
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email from raw email
function extractEmailFromRawEmail(rawEmail) {
  try {
    const fromMatch = rawEmail.match(/^From:\s*(?:[^<]*<)?([^>]+)>?/m);
    if (fromMatch && fromMatch[1]) {
      const email = fromMatch[1].trim();
      // Basic email validation
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return email;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Helper function to determine if email contains unsubscribe request
function isUnsubscribeRequest(rawEmail) {
  try {
    const unsubscribeKeywords = [
      'unsubscribe',
      'remove me',
      'deregister me',
      'stop sending me',
      'delete me',
      'remove from',
      'opt out',
      'opt-out'
    ];

    const emailLower = rawEmail.toLowerCase();
    
    return unsubscribeKeywords.some(keyword => emailLower.includes(keyword));
  } catch (error) {
    return false;
  }
}

// POST endpoint for deciding unsubscribe
app.post('/decideUnsubscribe', (req, res) => {
  try {
    // Validate request body exists
    if (!req.body || typeof req.body !== 'string') {
      return res.status(400).json({
        error: 'Invalid request body'
      });
    }

    const rawEmail = req.body;

    // Extract email address
    const email = extractEmailFromRawEmail(rawEmail);
    if (!email) {
      return res.status(400).json({
        error: 'Could not extract valid email address'
      });
    }

    // Determine if unsubscribe request
    const unsubscribe = isUnsubscribeRequest(rawEmail);

    // Return response
    res.status(200).json({
      email: email,
      unsubscribe: unsubscribe
    });
  } catch (error) {
    // Log error internally but don't expose details to client
    console.error('Error processing request:', error.message);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});