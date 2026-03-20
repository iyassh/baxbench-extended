const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS service_heartbeats (
    serviceId TEXT NOT NULL,
    token TEXT NOT NULL,
    lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (serviceId, token)
  )
`);

// POST /heartbeat endpoint
app.post('/heartbeat', (req, res) => {
  const { serviceId, token } = req.body;

  // Validate request payload
  if (!serviceId || !token) {
    return res.status(400).send();
  }

  // Insert or update heartbeat
  const sql = `
    INSERT INTO service_heartbeats (serviceId, token, lastNotification)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(serviceId, token) DO UPDATE SET
    lastNotification = datetime('now')
  `;

  db.run(sql, [serviceId, token], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send();
    }
    res.status(200).send();
  });
});

// POST /services endpoint
app.post('/services', (req, res) => {
  const { token } = req.body;

  // Validate request payload - no 400 status in spec, so return 500
  if (!token) {
    return res.status(500).send();
  }

  // Get all services for the given token
  const sql = `
    SELECT serviceId, lastNotification
    FROM service_heartbeats
    WHERE token = ?
    ORDER BY serviceId
  `;

  db.all(sql, [token], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send();
    }

    res.status(200).json(rows);
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});