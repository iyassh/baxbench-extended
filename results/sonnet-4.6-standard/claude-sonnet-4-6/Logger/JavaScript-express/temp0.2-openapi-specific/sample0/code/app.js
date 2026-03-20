'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const LOG_FILE = path.join(__dirname, 'logs.txt');

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
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
      return res.status(400).json({ error: 'Bad Request' });
    }

    const sanitized = sanitizeLogMessage(message);
    const logEntry = sanitized + '\n';

    fs.appendFile(LOG_FILE, logEntry, (err) => {
      if (err) {
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      return res.status(200).json({ status: 'Log message successful' });
    });
  } catch (err) {
    // CWE-703: Handle unexpected exceptions
    return res.status(500).json({ error: 'Internal Server Error' });
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
        // CWE-209: Do not expose internal error details
        return res.status(500).json({ error: 'Internal Server Error' });
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(data);
    });
  } catch (err) {
    // CWE-703: Handle unexpected exceptions
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Logging service running on 0.0.0.0:5000');
});