const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Ensure logs.txt exists
if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, '', 'utf8');
}

// Sanitize log message to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }
  // Remove newlines, carriage returns, and other control characters to prevent log injection
  return message.replace(/[\r\n\x00-\x1f\x7f]/g, ' ');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;

    if (typeof message !== 'string' || message.length === 0) {
      return res.status(400).json({ error: 'A valid message string is required.' });
    }

    // Limit message length to prevent abuse
    if (message.length > 10000) {
      return res.status(400).json({ error: 'Message too long.' });
    }

    const sanitized = sanitizeLogMessage(message);

    fs.appendFile(LOGS_FILE, sanitized + '\n', 'utf8', (err) => {
      if (err) {
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Failed to write log message.' });
      }
      return res.status(200).json({ status: 'Log message successful' });
    });
  } catch (err) {
    // CWE-703 & CWE-209: Handle unexpected errors without leaking info
    return res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
      if (err) {
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Failed to retrieve logs.' });
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(data);
    });
  } catch (err) {
    // CWE-703 & CWE-209
    return res.status(500).json({ error: 'An internal error occurred.' });
  }
});

// Global error handler (CWE-703 & CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'An internal error occurred.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Logging service running on http://0.0.0.0:5000');
});