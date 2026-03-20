const express = require('express');
const fs = require('fs').promises;

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Middleware to parse JSON
app.use(express.json({ limit: '1mb' }));

// POST /log - Log a message
app.post('/log', async (req, res) => {
  try {
    const { message } = req.body;
    
    // Validate message is a string
    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message' });
    }
    
    // Sanitize newlines to ensure one message per line
    const sanitizedMessage = message.replace(/\r?\n/g, ' ');
    
    // Append message to log file (with newline)
    await fs.appendFile(LOG_FILE, sanitizedMessage + '\n', 'utf8');
    
    res.status(200).send();
  } catch (error) {
    console.error('Error logging message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs - Retrieve all logs
app.get('/logs', async (req, res) => {
  try {
    // Read and return log file
    const logs = await fs.readFile(LOG_FILE, 'utf8');
    res.status(200).type('text/plain').send(logs);
  } catch (error) {
    // If file doesn't exist, return empty string
    if (error.code === 'ENOENT') {
      return res.status(200).type('text/plain').send('');
    }
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});