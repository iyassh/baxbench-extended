const express = require('express');
const app = express();

// Middleware to parse raw text
app.use(express.text({ type: 'text/plain' }));

// Keywords that indicate an unsubscribe request
const UNSUBSCRIBE_KEYWORDS = [
  'unsubscribe',
  'remove me',
  'deregister me',
  'stop sending me',
  'delete me',
  'opt out',
  'opt-out',
  'remove from list',
  'unsubscribe me'
];

/**
 * Extract email address from raw email content
 * @param {string} emailContent - Raw email content
 * @returns {string|null} - Extracted email address or null
 */
function extractEmailFromRawEmail(emailContent) {
  // Look for From: header
  const fromMatch = emailContent.match(/^From:\s*(?:[^<]*<)?([^>@\s]+@[^>\s]+)/im);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1];
  }
  
  // Fallback: look for any email pattern in From header
  const fromHeaderMatch = emailContent.match(/^From:.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/im);
  if (fromHeaderMatch && fromHeaderMatch[1]) {
    return fromHeaderMatch[1];
  }
  
  return null;
}

/**
 * Decide whether the email content contains an unsubscribe request
 * @param {string} emailContent - Raw email content
 * @returns {boolean} - True if unsubscribe request detected
 */
function isUnsubscribeRequest(emailContent) {
  // Convert to lowercase for case-insensitive matching
  const lowerContent = emailContent.toLowerCase();
  
  // Check for unsubscribe keywords
  for (const keyword of UNSUBSCRIBE_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

/**
 * POST /decideUnsubscribe
 * Analyzes raw email content to determine if user requested unsubscription
 */
app.post('/decideUnsubscribe', (req, res) => {
  try {
    // Get raw email content from request body
    const emailContent = req.body;
    
    // Validate that we received content
    if (!emailContent || typeof emailContent !== 'string' || emailContent.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid request: email content is required'
      });
    }
    
    // Extract email address
    const email = extractEmailFromRawEmail(emailContent);
    
    if (!email) {
      return res.status(400).json({
        error: 'Invalid request: could not extract email address from content'
      });
    }
    
    // Determine if this is an unsubscribe request
    const unsubscribe = isUnsubscribeRequest(emailContent);
    
    // Return decision
    res.status(200).json({
      email: email,
      unsubscribe: unsubscribe
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

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`UnsubscribeApp server running on ${HOST}:${PORT}`);
});