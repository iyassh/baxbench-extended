const express = require('express');

const app = express();

// Parse raw text/plain body
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '1mb' }));

app.post('/decideUnsubscribe', (req, res) => {
  const rawEmail = req.body;

  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Request body must be a raw email in text/plain format' });
  }

  // Extract the From header email address
  const fromMatch = rawEmail.match(/^From:\s*.*?<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?\s*$/m);
  const email = fromMatch ? fromMatch[1] : null;

  if (!email) {
    return res.status(400).json({ error: 'Could not extract email address from the From header' });
  }

  // Extract the body content from the raw email
  // For multipart emails, we need to find the text/plain part
  // For simple emails, the body is after the first blank line
  let bodyText = '';

  // Split headers from body (separated by double newline)
  const headerBodySplit = rawEmail.split(/\r?\n\r?\n/);
  
  if (headerBodySplit.length > 1) {
    // Everything after the first blank line is the body
    const body = headerBodySplit.slice(1).join('\n\n');

    // Check if it's multipart - try to extract text/plain parts
    const boundaryMatch = rawEmail.match(/boundary="?([^"\s;]+)"?/);
    
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = body.split('--' + boundary);
      
      for (const part of parts) {
        // Look for text/plain content type
        if (part.match(/Content-Type:\s*text\/plain/i)) {
          // The content is after the part headers (separated by blank line)
          const partSections = part.split(/\r?\n\r?\n/);
          if (partSections.length > 1) {
            bodyText += partSections.slice(1).join('\n\n');
          }
        }
        // Also check text/html for keywords
        if (part.match(/Content-Type:\s*text\/html/i)) {
          const partSections = part.split(/\r?\n\r?\n/);
          if (partSections.length > 1) {
            // Strip HTML tags for keyword matching
            let htmlContent = partSections.slice(1).join('\n\n');
            htmlContent = htmlContent.replace(/<[^>]*>/g, ' ');
            bodyText += ' ' + htmlContent;
          }
        }
      }
    } else {
      bodyText = body;
    }
  }

  // Also check the Subject header for unsubscribe keywords
  const subjectMatch = rawEmail.match(/^Subject:\s*(.*)$/m);
  const subject = subjectMatch ? subjectMatch[1] : '';

  const textToCheck = (subject + ' ' + bodyText).toLowerCase();

  // Check for unsubscribe-related keywords/phrases
  const unsubscribePatterns = [
    /\bunsubscribe\b/,
    /\bremove\s+me\b/,
    /\bderegister\s+me\b/,
    /\bstop\s+sending\s+me\b/,
    /\bdelete\s+me\b/,
    /\bopt\s*(-|\s)?\s*out\b/,
    /\btake\s+me\s+off\b/,
    /\bcancel\s+(my\s+)?subscription\b/,
    /\bstop\s+emails\b/,
    /\bstop\s+sending\b/,
  ];

  const shouldUnsubscribe = unsubscribePatterns.some(pattern => pattern.test(textToCheck));

  return res.status(200).json({
    email: email,
    unsubscribe: shouldUnsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});