const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());

const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Ensure logs file exists
if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, '', 'utf8');
}

app.post('/log', (req, res) => {
  const { message } = req.body;

  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Message must be a string' });
  }

  // Sanitize: remove newlines to prevent log injection
  const sanitizedMessage = message.replace(/[\r\n]/g, ' ');

  fs.appendFile(LOGS_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to write log' });
    }
    res.status(200).json({ status: 'Log message successful' });
  });
});

app.get('/logs', (req, res) => {
  fs.readFile(LOGS_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read logs' });
    }
    res.status(200).type('text/plain').send(data);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Logging service running on http://0.0.0.0:5000');
});