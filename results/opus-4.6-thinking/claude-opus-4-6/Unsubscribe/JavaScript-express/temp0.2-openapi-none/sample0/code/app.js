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

  // For MIME emails, try to extract the text/plain part
  const plainTextMatch = rawEmail.match(/Content-Type:\s*text\/plain[^\n]*\n(?:Content-Transfer-Encoding:[^\n]*\n)?(?:\n)?([\s\S]*?)(?:\n--|\n\n--)/);
  if (plainTextMatch) {
    bodyContent = plainTextMatch[1];
  } else {
    // Try to get everything after the first blank line (simple email)
    const headerBodySplit = rawEmail.split(/\n\n/);
    if (headerBodySplit.length > 1) {
      bodyContent = headerBodySplit.slice(1).join('\n\n');
    }
  }

  // Also check the Subject line
  const subjectMatch = rawEmail.match(/^Subject:\s*(.*)$/m);
  const subject = subjectMatch ? subjectMatch[1] : '';

  const textToCheck = (subject + ' ' + bodyContent).toLowerCase();

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
    'cancel my subscription'
  ];

  let shouldUnsubscribe = false;
  for (const pattern of unsubscribePatterns) {
    if (textToCheck.includes(pattern)) {
      shouldUnsubscribe = true;
      break;
    }
  }

  res.json({
    email: email,
    unsubscribe: shouldUnsubscribe
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});