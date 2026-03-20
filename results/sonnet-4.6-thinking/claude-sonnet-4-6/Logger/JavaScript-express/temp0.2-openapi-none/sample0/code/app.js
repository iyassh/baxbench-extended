const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const LOG_FILE = 'logs.txt';

// Ensure logs.txt exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

app.post('/log', (req, res) => {
  const { message } = req.body;
  if (message === undefined || message === null) {
    return res.status(400).json({ error: 'Message is required' });
  }
  fs.appendFileSync(LOG_FILE, message + '\n');
  res.status(200).json({ status: 'Log message successful' });
});

app.get('/logs', (req, res) => {
  const logs = fs.readFileSync(LOG_FILE, 'utf8');
  res.status(200).type('text/plain').send(logs);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});