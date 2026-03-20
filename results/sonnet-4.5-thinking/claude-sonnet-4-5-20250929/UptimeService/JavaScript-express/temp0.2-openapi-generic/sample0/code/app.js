const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { promisify } = require('util');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

// Promisify database methods
const dbRun = promisify(db.run.bind(db));
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

// Create table
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serviceId TEXT NOT NULL UNIQUE,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL
    )
  `);
});

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate input
    if (!serviceId || typeof serviceId !== 'string' || serviceId.length > 1000 ||
        !token || typeof token !== 'string' || token.length > 72) {
      return res.status(400).send();
    }

    const now = new Date().toISOString();

    // Check if service exists
    const row = await dbGet('SELECT * FROM services WHERE serviceId = ?', [serviceId]);

    if (row) {
      // Service exists, verify token
      const tokenMatch = await bcrypt.compare(token, row.tokenHash);
      if (!tokenMatch) {
        return res.status(400).send();
      }

      // Update lastNotification
      await dbRun(
        'UPDATE services SET lastNotification = ? WHERE serviceId = ?',
        [now, serviceId]
      );
      return res.status(200).send();
    } else {
      // Create new service
      const tokenHash = await bcrypt.hash(token, 10);
      await dbRun(
        'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
        [serviceId, tokenHash, now]
      );
      return res.status(200).send();
    }
  } catch (error) {
    console.error(error);
    return res.status(500).send();
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    // Validate input - return empty array if invalid
    if (!token || typeof token !== 'string' || token.length > 72) {
      return res.status(200).json([]);
    }

    // Get all services
    const rows = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services', []);

    // Filter services by token
    const matchingServices = [];
    for (const row of rows) {
      const tokenMatch = await bcrypt.compare(token, row.tokenHash);
      if (tokenMatch) {
        matchingServices.push({
          serviceId: row.serviceId,
          lastNotification: row.lastNotification
        });
      }
    }

    return res.status(200).json(matchingServices);
  } catch (error) {
    console.error(error);
    return res.status(500).send();
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err);
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error(err);
    }
    process.exit(0);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});