const express = require('express');
const app = express();

// Middleware to handle raw text body
app.use(express.text({ type: 'text/plain' }));

// Keywords that indicate an unsubscribe request
const unsubscribeKeywords = [
  'unsubscribe',
  'remove me',
  'deregister me',
  'stop sending me',
  'delete me',
  'remove from',
  'opt out',
  'unsubscribe me'
];

// Function to extract email from raw email content
function extractEmail(rawEmail) {
  const fromMatch = rawEmail.match(/^From:\s*(?:[^<]*<)?([^>]+)(?:>)?$/m);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1].trim();
  }
  return null;
}

// Function to extract body content from raw email
function extractEmailBody(rawEmail) {
  // Split by boundary markers and content-type headers
  const lines = rawEmail.split('\n');
  let bodyContent = '';
  let inBody = false;
  let skipNextEmpty = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip headers and boundary markers
    if (line.startsWith('--') || line.match(/^Content-/i)) {
      inBody = false;
      skipNextEmpty = true;
      continue;
    }

    // Skip empty lines after headers
    if (skipNextEmpty && line.trim() === '') {
      skipNextEmpty = false;
      inBody = true;
      continue;
    }

    // Collect body content
    if (inBody || (!line.match(/^[A-Z][a-z-]*:/) && line.trim() !== '')) {
      bodyContent += line + ' ';
      inBody = true;
    }
  }

  return bodyContent.toLowerCase();
}

// Function to decide if user should be unsubscribed
function shouldUnsubscribe(emailBody) {
  const bodyLower = emailBody.toLowerCase();
  
  for (const keyword of unsubscribeKeywords) {
    if (bodyLower.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

// POST endpoint for deciding unsubscribe
app.post('/decideUnsubscribe', (req, res) => {
  try {
    const rawEmail = req.body;

    if (!rawEmail || typeof rawEmail !== 'string') {
      return res.status(400).json({
        error: 'Invalid request body. Expected raw email as text/plain.'
      });
    }

    // Extract email address
    const email = extractEmail(rawEmail);
    if (!email) {
      return res.status(400).json({
        error: 'Could not extract email address from the provided email.'
      });
    }

    // Extract email body content
    const emailBody = extractEmailBody(rawEmail);

    // Decide if user should be unsubscribed
    const unsubscribe = shouldUnsubscribe(emailBody);

    // Return decision
    res.status(200).json({
      email: email,
      unsubscribe: unsubscribe
    });
  } catch (error) {
    res.status(500).json({
      error: 'An error occurred while processing the email.',
      details: error.message
    });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`UnsubscribeApp server is running on http://0.0.0.0:${PORT}`);
});