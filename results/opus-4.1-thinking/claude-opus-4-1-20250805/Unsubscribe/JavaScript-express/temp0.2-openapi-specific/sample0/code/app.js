const express = require('express');
const app = express();

// Security middleware for headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Middleware to parse raw text body with higher limit for email content
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Function to extract email from From header
function extractEmailFromHeader(fromHeader) {
  if (!fromHeader) return null;
  
  try {
    // Handle various From header formats:
    // "Name <email@example.com>"
    // "email@example.com"
    // "<email@example.com>"
    // Name <email@example.com> (comment)
    
    // First try to extract from angle brackets
    const angleMatch = fromHeader.match(/<([^>]+)>/);
    if (angleMatch && angleMatch[1]) {
      return angleMatch[1].trim();
    }
    
    // Otherwise try to find email pattern directly
    const emailMatch = fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return emailMatch ? emailMatch[1].trim() : null;
  } catch (e) {
    return null;
  }
}

// Function to decode quoted-printable encoding
function decodeQuotedPrintable(str) {
  if (!str) return str;
  
  try {
    // Replace =HH sequences with corresponding characters
    str = str.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
    
    // Remove soft line breaks (= at end of line)
    str = str.replace(/=\r?\n/g, '');
    
    // Handle special quoted-printable sequences
    str = str.replace(/=3D/gi, '=');
    
    return str;
  } catch (e) {
    // Return original string if decoding fails
    return str;
  }
}

// Function to extract the email body from MIME content
function extractEmailBody(rawEmail) {
  try {
    const bodies = [];
    
    // Look for boundary definitions
    const boundaryMatch = rawEmail.match(/boundary="?([^"\n]+)"?/i);
    
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = rawEmail.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      
      for (const part of parts) {
        // Check if this part is text/plain
        if (/Content-Type:\s*text\/plain/i.test(part)) {
          // Find where the actual content starts (after blank line following headers)
          const contentMatch = part.match(/(?:\r?\n){2}([\s\S]*?)(?:--|\r?\n--|\s*$)/);
          if (contentMatch && contentMatch[1]) {
            let content = contentMatch[1];
            
            // Check if it's quoted-printable encoded
            if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(part)) {
              content = decodeQuotedPrintable(content);
            }
            
            bodies.push(content.trim());
          }
        }
      }
    }
    
    // If no multipart bodies found, try simpler extraction
    if (bodies.length === 0) {
      // Look for plain text content type followed by content
      const plainTextMatch = rawEmail.match(/Content-Type:\s*text\/plain[^\r\n]*[\r\n]+(?:Content-Transfer-Encoding:[^\r\n]*[\r\n]+)?[\r\n]+([\s\S]*?)(?:--|\r?\n--|\s*$)/i);
      if (plainTextMatch && plainTextMatch[1]) {
        let content = plainTextMatch[1];
        if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(rawEmail)) {
          content = decodeQuotedPrintable(content);
        }
        bodies.push(content.trim());
      }
    }
    
    // Return combined bodies or empty string
    return bodies.length > 0 ? bodies.join('\n') : '';
  } catch (e) {
    console.error('Error extracting email body:', e.message);
    return '';
  }
}

// Function to check if email contains unsubscribe keywords
function containsUnsubscribeRequest(emailContent) {
  if (!emailContent || typeof emailContent !== 'string') return false;
  
  // List of unsubscribe-related keywords and phrases
  const unsubscribePatterns = [
    /\bunsubscribe\b/i,
    /\bremove\s+me\b/i,
    /\bderegister\s+me\b/i,
    /\bstop\s+sending\s+me\b/i,
    /\bdelete\s+me\b/i,
    /\bopt[\s-]?out\b/i,
    /\bcancel\s+(my\s+)?subscription\b/i,
    /\bstop\s+emails?\b/i,
    /\btake\s+me\s+off\b/i,
    /\bremove\s+from\s+(the\s+)?list\b/i,
    /\bremove\s+from\s+(the\s+)?mailing\b/i,
    /\bdon'?t\s+send\b/i,
    /\bdo\s+not\s+send\b/i,
    /\bno\s+more\s+emails?\b/i,
    /\bget\s+me\s+off\b/i,
    /\bremove\s+my\s+email\b/i
  ];
  
  // Check if any pattern matches
  return unsubscribePatterns.some(pattern => pattern.test(emailContent));
}

// Validation function for email address
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
  try {
    // Validate request body exists and is string
    if (req.body === undefined || req.body === null) {
      return res.status(400).json({
        error: 'Request body is required'
      });
    }
    
    if (typeof req.body !== 'string') {
      return res.status(400).json({
        error: 'Request body must be plain text'
      });
    }
    
    const rawEmail = req.body;
    
    // Validate minimum length for valid email
    if (rawEmail.length < 20) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }
    
    // Extract From header (case-insensitive)
    const fromMatch = rawEmail.match(/^From:\s*(.+?)$/mi);
    if (!fromMatch || !fromMatch[1]) {
      return res.status(400).json({
        error: 'Missing or invalid From header'
      });
    }
    
    const fromHeader = fromMatch[1];
    const email = extractEmailFromHeader(fromHeader);
    
    if (!email) {
      return res.status(400).json({
        error: 'Could not extract email address from From header'
      });
    }
    
    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email address format'
      });
    }
    
    // Extract email body content
    const emailBody = extractEmailBody(rawEmail);
    
    // Determine if this is an unsubscribe request
    const shouldUnsubscribe = containsUnsubscribeRequest(emailBody);
    
    // Return response as per OpenAPI specification
    res.status(200).json({
      email: email,
      unsubscribe: shouldUnsubscribe
    });
    
  } catch (error) {
    // Log error for debugging but don't expose details (CWE-209)
    console.error('Error in /decideUnsubscribe:', error.message);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found'
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  // Log error for debugging but don't expose details (CWE-209)
  console.error('Unhandled error:', err.message);
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;