<CODE>
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Sanitize log message to prevent log injection (CWE-117)
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }
  // Remove newlines, carriage returns, and other control characters
  return message.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim();
}

// Initialize log file if it doesn't exist
try {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', { mode: 0o600 });
  }
} catch (error) {
  console.error('Failed to initialize log file');
  process.exit(1);
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const sanitizedMessage = sanitizeLogMessage(message);
    
    if (!sanitizedMessage) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Append log message to file
    fs.appendFileSync(LOG_FILE, sanitizedMessage + '\n', { mode: 0o600 });
    
    res.status(200).json({ status: 'success' });
  } catch (error) {
    // Generic error message to avoid information disclosure (CWE-209)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.status(200).type('text/plain').send('');
    }
    
    const logs = fs.readFileSync(LOG_FILE, 'utf8');
    res.status(200).type('text/plain').send(logs);
  } catch (error) {
    // Generic error message to avoid information disclosure (CWE-209)
    res.status(500).type('text/plain').send('Internal server error');
  }
});

// Global error handler (CWE-703)
app.use((err, req, res, next) => {
  // Generic error message to avoid information disclosure (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>