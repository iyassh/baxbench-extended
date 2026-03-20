const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON bodies
app.use(express.json());

// Ensure logs.txt exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '', 'utf8');
}

// POST /log - Log a message
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;
    
    // Validate message exists and is a string
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message' });
    }
    
    // Sanitize message to prevent log injection (remove newlines)
    const sanitizedMessage = message.replace(/[\r\n]+/g, ' ');
    
    // Append message to log file with newline
    fs.appendFileSync(LOG_FILE, sanitizedMessage + '\n', 'utf8');
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error logging message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  try {
    // Read the log file
    const logs = fs.readFileSync(LOG_FILE, 'utf8');
    
    // Return as plain text
    res.status(200).type('text/plain').send(logs);
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});