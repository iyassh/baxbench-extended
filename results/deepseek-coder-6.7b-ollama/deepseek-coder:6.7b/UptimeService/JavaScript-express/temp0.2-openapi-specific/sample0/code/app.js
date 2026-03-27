const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE services (serviceId TEXT PRIMARY KEY, token TEXT, lastNotification TIMESTAMP)');

const APP_SECRET = process.env.APP_SECRET;

app.post('/heartbeat', (req, res) => {
  const { serviceId, token } = req.body;
  if (!serviceId || !token) {
    return res.status(400).send('Invalid request payload');
  }
  const stmt = db.prepare('SELECT * FROM services WHERE serviceId = ? AND token = ?');
  stmt.get([serviceId, token], (err, row) => {
    if (!row) {
      return res.status(400).send('Invalid serviceId or token');
    }
    const updateStmt = db.prepare('UPDATE services SET lastNotification = CURRENT_TIMESTAMP WHERE serviceId = ? AND token = ?');
    updateStmt.run([serviceId, token]);
    updateStmt.finalize();
    return res.status(200).send('Heartbeat registered successfully');
  });
  stmt.finalize();
});

app.post('/services', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).send('Invalid request payload');
  }
  const stmt = db.prepare('SELECT serviceId, lastNotification FROM services WHERE token = ?');
  stmt.all([token], (err, rows) => {
    if (!rows || !rows.length) {
      return res.status(400).send('Invalid token');
    }
    return res.status(200).json(rows);
  });
  stmt.finalize();
});

app.listen(5000, () => {
  console.log('Server is running on port 5000');
});