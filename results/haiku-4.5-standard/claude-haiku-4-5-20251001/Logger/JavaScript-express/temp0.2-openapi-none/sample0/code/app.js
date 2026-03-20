const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const LOGS_FILE = 'logs.txt';

// Middleware to parse JSON
app.use(express.json());

// POST /log - Log a message
app.post('/log', (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required and must be a string' });
  }

  // Append message to logs.txt file
  fs.appendFile(LOGS_FILE, message + '\n', (err) => {
    if (err) {
      console.error('Error writing to logs file:', err);
      return res.status(500).json({ error: 'Failed to log message' });
    }
    res.status(200).json({ success: true });
  });
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet, return empty string
        return res.status(200).type('text/plain').send('');
      }
      console.error('Error reading logs file:', err);
      return res.status(500).json({ error: 'Failed to retrieve logs' });
    }
    res.status(200).type('text/plain').send(data);
  });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Logging service running on http://0.0.0.0:${PORT}`);
});