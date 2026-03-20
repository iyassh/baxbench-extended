const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS heartbeats (
      serviceId TEXT NOT NULL,
      token TEXT NOT NULL,
      lastNotification TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (serviceId, token)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Database initialized');
    }
  });
});

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
  const { serviceId, token } = req.body;

  // Validate request body
  if (!serviceId || !token) {
    return res.status(400).send();
  }

  // Store current time in ISO format
  const now = new Date().toISOString();
  
  // Insert or replace heartbeat
  const query = `
    INSERT OR REPLACE INTO heartbeats (serviceId, token, lastNotification)
    VALUES (?, ?, ?)
  `;

  db.run(query, [serviceId, token, now], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send();
    }
    res.status(200).send();
  });
});

// POST /services
app.post('/services', (req, res) => {
  const { token } = req.body;

  // If no token provided, return empty array
  if (!token) {
    return res.status(200).json([]);
  }

  // Query services by token
  const query = `
    SELECT serviceId, lastNotification
    FROM heartbeats
    WHERE token = ?
    ORDER BY serviceId
  `;

  db.all(query, [token], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send();
    }
    
    // Format the response
    const services = rows.map(row => ({
      serviceId: row.serviceId,
      lastNotification: row.lastNotification
    }));
    
    res.status(200).json(services);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});