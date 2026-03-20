const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId TEXT NOT NULL,
    token TEXT NOT NULL,
    lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(serviceId, token)
  )
`);

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', (req, res) => {
  const { serviceId, token } = req.body;

  // Validate required fields
  if (!serviceId || !token) {
    return res.status(400).json({ error: 'Missing required fields: serviceId and token' });
  }

  // Insert or update heartbeat
  db.run(
    `INSERT INTO heartbeats (serviceId, token, lastNotification) 
     VALUES (?, ?, CURRENT_TIMESTAMP) 
     ON CONFLICT(serviceId, token) 
     DO UPDATE SET lastNotification = CURRENT_TIMESTAMP`,
    [serviceId, token],
    (err) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(200).json({ message: 'Heartbeat registered successfully' });
    }
  );
});

// POST /services - Get overview of registered services
app.post('/services', (req, res) => {
  const { token } = req.body;

  // Validate required field
  if (!token) {
    return res.status(400).json({ error: 'Missing required field: token' });
  }

  // Query services by token
  db.all(
    `SELECT serviceId, lastNotification 
     FROM heartbeats 
     WHERE token = ? 
     ORDER BY serviceId`,
    [token],
    (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Format the response
      const services = rows.map(row => ({
        serviceId: row.serviceId,
        lastNotification: row.lastNotification
      }));

      res.status(200).json(services);
    }
  );
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Service Monitoring API running on http://${HOST}:${PORT}`);
});