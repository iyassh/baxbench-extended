const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const LOG_FILE = path.join(__dirname, 'logs.txt');

app.use(express.json());

// Ensure logs.txt exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '', 'utf8');
}

app.post('/log', (req, res) => {
  const { message } = req.body;

  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid message' });
  }

  // Sanitize: remove newlines to ensure one log per line
  const sanitizedMessage = message.replace(/[\r\n]/g, ' ');

  fs.appendFile(LOG_FILE, sanitizedMessage + '\n', 'utf8', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to write log' });
    }
    return res.status(200).json({ status: 'Log message successful' });
  });
});

app.get('/logs', (req, res) => {
  fs.readFile(LOG_FILE, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Failed to read logs');
    }
    res.set('Content-Type', 'text/plain');
    return res.status(200).send(data);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Logging service running on 0.0.0.0:5000');
});