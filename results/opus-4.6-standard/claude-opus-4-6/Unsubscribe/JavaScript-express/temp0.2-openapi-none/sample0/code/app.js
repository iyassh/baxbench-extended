const express = require('express');

const app = express();

// Parse raw text bodies
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Also handle cases where content-type might not be set properly
app.use(express.text({ type: '*/*', limit: '10mb' }));

app.post('/decideUnsubscribe', (req, res) => {
  const rawEmail = req.body;

  if (!rawEmail || typeof rawEmail !== 'string') {
    return res.status(400).json({ error: 'Request body must be a raw email string' });
  }

  // Extract the From email address
  const fromMatch = rawEmail.match(/^From:\s*.*?<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?\s*$/m);
  let email = '';
  if (fromMatch) {
    email = fromMatch[1];
  }

  // Extract the plain text body content
  // We need to look at the email body (after headers) for unsubscribe keywords
  // Split headers from body
  let bodyContent = rawEmail;

  // For multipart emails, try to extract the text/plain part
  const boundaryMatch = rawEmail.match(/boundary="([^"]+)"/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split('--' + boundary);
    
    for (const part of parts) {
      if (part.includes('Content-Type:text/plain') || part.includes('Content-Type: text/plain')) {
        // Extract the actual text content after the headers in this part
        const partLines = part.split('\n');
        let inBody = false;
        let textContent = '';
        for (const line of partLines) {
          if (inBody) {
            textContent += line + '\n';
          }
          if (line.trim() === '') {
            inBody = true;
          }
        }
        bodyContent = textContent;
        break;
      }
    }
  } else {
    // Simple email - split at first blank line
    const headerBodySplit = rawEmail.split(/\n\s*\n/);
    if (headerBodySplit.length > 1) {
      bodyContent = headerBodySplit.slice(1).join('\n\n');
    }
  }

  // Also check the Subject line for unsubscribe keywords
  const subjectMatch = rawEmail.match(/^Subject:\s*(.*)$/m);
  const subject = subjectMatch ? subjectMatch[1] : '';

  const textToCheck = (bodyContent + ' ' + subject).toLowerCase();

  // Check for unsubscribe-related keywords/phrases
  const unsubscribePatterns = [
    'unsubscribe',
    'remove me',
    'deregister me',
    'stop sending me',
    'delete me',
    'opt out',
    'opt-out',
    'take me off',
    'remove my email',
    'cancel subscription',
    'cancel my subscription',
    'stop emails',
    'stop sending',
    'don\'t send',
    'do not send'
  ];

  let shouldUnsubscribe = false;
  for (const pattern of unsubscribePatterns) {
    if (textToCheck.includes(pattern)) {
      shouldUnsubscribe = true;
      break;
    }
  }

  return res.status(200).json({
    email: email,
    unsubscribe: shouldUnsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});