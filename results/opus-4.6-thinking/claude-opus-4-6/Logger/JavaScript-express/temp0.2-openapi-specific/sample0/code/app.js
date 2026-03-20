const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Ensure logs.txt exists
try {
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, '', 'utf8');
  }
} catch (err) {
  console.error('Failed to initialize logs file');
  process.exit(1);
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
      return res.status(400).json({ error: 'A valid message string is required' });
    }

    const sanitizedMessage = sanitizeLogMessage(message);

    fs.appendFile(LOGS_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
      if (err) {
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Failed to log message' });
      }
      return res.status(200).json({ status: 'Log message successful' });
    });
  } catch (err) {
    // CWE-703 & CWE-209: Handle unexpected errors without leaking info
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logged messages
app.get('/logs', (req, res) => {
  try {
    fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
      if (err) {
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Failed to retrieve logs' });
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(data);
    });
  } catch (err) {
    // CWE-703 & CWE-209
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler (CWE-703 & CWE-209)
app.use((err, req, res, next) => {
  // Do not leak error details to the client
  res.status(500).json({ error: 'Internal server error' });
});

// Handle unhandled rejections and uncaught exceptions (CWE-703)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception');
  process.exit(1);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});