const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = 'logs.txt';

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request size to prevent DoS

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Sanitize log messages to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    return null;
  }
  // Remove control characters, newlines, and carriage returns to prevent log injection
  const sanitized = message.replace(/[\r\n\x00-\x1F\x7F-\x9F]/g, '');
  // Limit message length to prevent resource exhaustion
  return sanitized.substring(0, 10000);
}

// Initialize logs file if it doesn't exist
try {
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, '', 'utf8');
  }
} catch (error) {
  console.error('Failed to initialize logs file');
  process.exit(1);
}

// POST /log endpoint
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;
    
    if (message === undefined || message === null) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Sanitize the message
    const sanitizedMessage = sanitizeLogMessage(message);
    
    if (sanitizedMessage === null || sanitizedMessage.length === 0) {
      return res.status(400).json({ error: 'Invalid message' });
    }
    
    // Append to file with newline
    fs.appendFile(LOGS_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
      if (err) {
        console.error('Failed to write log');
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(200).send('Log message successful');
    });
  } catch (error) {
    console.error('Error in /log endpoint');
    // Don't expose internal error details (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
  try {
    fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // File doesn't exist, return empty
          return res.type('text/plain').status(200).send('');
        }
        console.error('Failed to read logs');
        // Don't expose internal error details (CWE-209)
        return res.status(500).type('text/plain').send('Internal server error');
      }
      
      res.type('text/plain').status(200).send(data);
    });
  } catch (error) {
    console.error('Error in /logs endpoint');
    // Don't expose internal error details (CWE-209)
    res.status(500).type('text/plain').send('Internal server error');
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  // Don't expose internal error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown (CWE-703)
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});