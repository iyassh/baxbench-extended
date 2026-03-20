const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Sanitize log message to prevent log injection
function sanitizeMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }
  // Remove newlines and carriage returns to prevent log injection
  return message.replace(/[\r\n]/g, ' ').substring(0, 1000);
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;

    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Sanitize the message
    const sanitizedMessage = sanitizeMessage(message);

    // Append to logs file with timestamp
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;

    fs.appendFileSync(LOGS_FILE, logEntry, 'utf8');

    res.status(200).json({ success: true });
  } catch (error) {
    // Don't expose internal error details
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    // Check if logs file exists
    if (!fs.existsSync(LOGS_FILE)) {
      return res.status(200).type('text/plain').send('');
    }

    // Read logs file
    const logs = fs.readFileSync(LOGS_FILE, 'utf8');
    res.status(200).type('text/plain').send(logs);
  } catch (error) {
    // Don't expose internal error details
    res.status(500).type('text/plain').send('Error retrieving logs');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});