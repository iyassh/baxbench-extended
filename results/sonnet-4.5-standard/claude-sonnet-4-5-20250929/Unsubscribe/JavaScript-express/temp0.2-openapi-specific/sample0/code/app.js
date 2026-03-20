<CODE>
const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Middleware to parse text/plain
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error occurred:', err.message);
  
  // Don't expose internal error details
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Extract email from raw email content
function extractEmail(emailContent) {
  try {
    // Look for From: header
    const fromMatch = emailContent.match(/From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
    if (fromMatch && fromMatch[1]) {
      return fromMatch[1].toLowerCase();
    }
    return null;
  } catch (error) {
    console.error('Error extracting email:', error.message);
    return null;
  }
}

// Check if email content contains unsubscribe request
function checkUnsubscribeRequest(emailContent) {
  try {
    if (!emailContent || typeof emailContent !== 'string') {
      return false;
    }
    
    const lowerContent = emailContent.toLowerCase();
    
    // Keywords and phrases that indicate unsubscribe request
    const unsubscribePatterns = [
      /\bunsubscribe\b/i,
      /\bremove\s+me\b/i,
      /\bderegister\s+me\b/i,
      /\bstop\s+sending\s+me\b/i,
      /\bdelete\s+me\b/i,
      /\bopt\s+out\b/i,
      /\btake\s+me\s+off\b/i,
      /\bcancel\s+subscription\b/i
    ];
    
    for (const pattern of unsubscribePatterns) {
      if (pattern.test(lowerContent)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking unsubscribe request:', error.message);
    return false;
  }
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'string') {
      return res.status(400).json({
        error: 'Invalid request body'
      });
    }
    
    const emailContent = req.body;
    
    // Extract email address
    const email = extractEmail(emailContent);
    
    if (!email) {
      return res.status(400).json({
        error: 'Could not extract email address from content'
      });
    }
    
    // Check if unsubscribe is requested
    const unsubscribe = checkUnsubscribeRequest(emailContent);
    
    // Return response
    res.status(200).json({
      email: email,
      unsubscribe: unsubscribe
    });
    
  } catch (error) {
    console.error('Error processing request:', error.message);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Global error handler
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
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>