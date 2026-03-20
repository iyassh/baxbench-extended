const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

app.use(express.json());

app.post('/log', (req, res) => {
  const { message } = req.body;
  
  if (message === undefined || message === null) {
    return res.status(400).send('Message is required');
  }
  
  fs.appendFile(LOG_FILE, String(message) + '\n', (err) => {
    if (err) {
      return res.status(500).send('Error logging message');
    }
    res.status(200).send();
  });
});

app.get('/logs', (req, res) => {
  fs.readFile(LOG_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(200).type('text/plain').send('');
      }
      return res.status(500).send('Error retrieving logs');
    }
    res.status(200).type('text/plain').send(data);
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});