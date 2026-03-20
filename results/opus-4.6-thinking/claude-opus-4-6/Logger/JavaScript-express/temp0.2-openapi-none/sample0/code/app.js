const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const LOGS_FILE = path.join(__dirname, 'logs.txt');

// Ensure logs.txt exists
if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, '');
}

app.post('/log', (req, res) => {
  const { message } = req.body;
  fs.appendFileSync(LOGS_FILE, message + '\n');
  res.status(200).send('Log message successful');
});

app.get('/logs', (req, res) => {
  const logs = fs.readFileSync(LOGS_FILE, 'utf-8');
  res.status(200).type('text/plain').send(logs);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});