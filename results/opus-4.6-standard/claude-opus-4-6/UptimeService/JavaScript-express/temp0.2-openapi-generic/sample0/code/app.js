const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(DB_PATH);

const SALT_ROUNDS = 10;

// Initialize database
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

// Helper to run db operations as promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
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
    const rows = await dbAll('SELECT rowid, tokenHash FROM services WHERE serviceId = ?', [serviceId]);

    if (rows.length > 0) {
      // Check if any existing row matches the token
      for (const row of rows) {
        const match = await bcrypt.compare(token, row.tokenHash);
        if (match) {
          await dbRun('UPDATE services SET lastNotification = ? WHERE rowid = ?', [now, row.rowid]);
          return res.status(200).json({ message: 'Heartbeat registered successfully.' });
        }
      }
    }

    // No existing entry found for this serviceId+token combo, create new
    const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
    await dbRun('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', [serviceId, tokenHash, now]);

    return res.status(200).json({ message: 'Heartbeat registered successfully.' });
  } catch (err) {
    console.error(err);
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

    const allServices = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services');

    const results = [];
    for (const service of allServices) {
      const match = await bcrypt.compare(token, service.tokenHash);
      if (match) {
        results.push({
          serviceId: service.serviceId,
          lastNotification: service.lastNotification
        });
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Service Monitoring API running on http://0.0.0.0:5000');
});