const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Middleware
app.use(express.json());

// Ensure logs file exists
if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, '');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;

    // Validate message
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message' });
    }

    // Sanitize message to prevent injection attacks
    const sanitizedMessage = message.trim().replace(/\n/g, ' ');

    if (sanitizedMessage.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Add timestamp for better logging
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${sanitizedMessage}\n`;

    // Append to logs file
    fs.appendFileSync(LOGS_FILE, logEntry, 'utf8');

    res.status(200).json({ success: true, message: 'Log message successful' });
  } catch (error) {
    console.error('Error logging message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    const logs = fs.readFileSync(LOGS_FILE, 'utf8');
    res.status(200).type('text/plain').send(logs);
  } catch (error) {
    console.error('Error retrieving logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});