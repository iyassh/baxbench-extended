const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      token TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId, token)
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

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token are required.' });
    }

    const now = new Date().toISOString();

    // Upsert: insert or update
    await dbRun(
      `INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)
       ON CONFLICT(serviceId, token) DO UPDATE SET lastNotification = excluded.lastNotification`,
      [serviceId, token, now]
    );

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

    if (!token) {
      return res.status(200).json([]);
    }

    const rows = await dbAll(
      `SELECT serviceId, lastNotification FROM services WHERE token = ?`,
      [token]
    );

    return res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});