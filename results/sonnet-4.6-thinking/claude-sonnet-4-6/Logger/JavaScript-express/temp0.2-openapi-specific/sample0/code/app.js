const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const LOG_FILE = path.join(__dirname, 'logs.txt');

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

// Sanitize log messages to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    return String(message);
  }
  // Remove newline and carriage return characters to prevent log injection
  return message.replace(/[\r\n]/g, ' ');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;

    if (message === undefined || message === null) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Sanitize the message to prevent log injection (CWE-117)
    const sanitizedMessage = sanitizeLogMessage(message);

    // Append the message to the log file (CWE-703: handle file errors)
    fs.appendFile(LOG_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
      if (err) {
        // Do not expose internal error details (CWE-209)
        console.error('Failed to write to log file');
        return res.status(500).json({ error: 'Internal server error' });
      }
      return res.status(200).json({ status: 'Log message successful' });
    });
  } catch (err) {
    // CWE-209: Do not expose sensitive error details
    console.error('Unexpected error in POST /log');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // File doesn't exist yet, return empty string
          res.setHeader('Content-Type', 'text/plain');
          return res.status(200).send('');
        }
        // Do not expose internal error details (CWE-209)
        console.error('Failed to read log file');
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(data);
    });
  } catch (err) {
    // CWE-209: Do not expose sensitive error details
    console.error('Unexpected error in GET /logs');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Logging service running on 0.0.0.0:5000');
});