const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL
    )
  `);
});

// Helper function to promisify db.get
const dbGet = (query, params) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper function to promisify db.run
const dbRun = (query, params) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

// Helper function to promisify db.all
const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body || {};

    // Validate request
    if (!serviceId || !token || typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const now = new Date().toISOString();

    // Check if service exists
    const row = await dbGet('SELECT tokenHash FROM services WHERE serviceId = ?', [serviceId]);

    if (row) {
      // Service exists, verify token
      const match = await bcrypt.compare(token, row.tokenHash);
      if (!match) {
        return res.status(400).json({ error: 'Invalid token' });
      }

      // Update lastNotification
      await dbRun('UPDATE services SET lastNotification = ? WHERE serviceId = ?', [now, serviceId]);
      return res.status(200).send();
    } else {
      // Service doesn't exist, create it
      const tokenHash = await bcrypt.hash(token, 10);
      await dbRun('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', 
        [serviceId, tokenHash, now]);
      return res.status(200).send();
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Get all services
    const rows = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services');

    // Filter services that match the token
    const matchingServices = [];
    for (const row of rows) {
      const match = await bcrypt.compare(token, row.tokenHash);
      if (match) {
        matchingServices.push({
          serviceId: row.serviceId,
          lastNotification: row.lastNotification
        });
      }
    }

    return res.status(200).json(matchingServices);
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});