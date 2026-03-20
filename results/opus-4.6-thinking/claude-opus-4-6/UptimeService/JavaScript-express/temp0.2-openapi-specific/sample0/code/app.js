const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

const SALT_ROUNDS = 10;

// Initialize SQLite database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId, tokenHash)
    )
  `);
});

// Helper to hash token
async function hashToken(token) {
  return bcrypt.hash(token, SALT_ROUNDS);
}

// Helper to compare token
async function compareToken(token, hash) {
  return bcrypt.compare(token, hash);
}

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || typeof serviceId !== 'string' || !token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    const now = new Date().toISOString();

    // Check if there's an existing entry for this serviceId
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT rowid, tokenHash FROM services WHERE serviceId = ?', [serviceId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Check if any existing row matches the token
    let matched = false;
    for (const row of rows) {
      const isMatch = await compareToken(token, row.tokenHash);
      if (isMatch) {
        // Update the existing entry
        await new Promise((resolve, reject) => {
          db.run('UPDATE services SET lastNotification = ? WHERE rowid = ?', [now, row.rowid], function (err) {
            if (err) reject(err);
            else resolve();
          });
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Insert new entry with hashed token
      const tokenHash = await hashToken(token);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', [serviceId, tokenHash, now], function (err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    return res.status(200).json({ message: 'Heartbeat registered successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(200).json([]);
    }

    // Get all services and check which ones match the token
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const matchedServices = [];
    for (const row of rows) {
      const isMatch = await compareToken(token, row.tokenHash);
      if (isMatch) {
        matchedServices.push({
          serviceId: row.serviceId,
          lastNotification: row.lastNotification
        });
      }
    }

    return res.status(200).json(matchedServices);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Generic error handler
app.use((err, req, res, next) => {
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});