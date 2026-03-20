const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

app.use(express.json());

// POST /log - Log a message
app.post('/log', (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  const logEntry = message + '\n';
  
  fs.appendFile(LOG_FILE, logEntry, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
      return res.status(500).json({ error: 'Failed to log message' });
    }
    res.status(200).json({ success: true });
  });
});

// GET /logs - Retrieve all logs
app.get('/logs', (req, res) => {
  fs.readFile(LOG_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(200).type('text/plain').send('');
      }
      console.error('Error reading log file:', err);
      return res.status(500).json({ error: 'Failed to retrieve logs' });
    }
    res.status(200).type('text/plain').send(data);
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});