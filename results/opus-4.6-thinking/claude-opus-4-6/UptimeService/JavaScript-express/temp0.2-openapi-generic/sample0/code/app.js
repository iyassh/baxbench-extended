const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

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

// Helper to hash tokens consistently for lookup
// We need to be able to look up by token, but bcrypt produces different hashes each time.
// So we'll store a deterministic hash for grouping/lookup and also the bcrypt hash for verification.
// Actually, rethinking: the token is used as a shared secret between heartbeat and services endpoint.
// The same token sent to /heartbeat should allow /services to see those services.
// We need to match tokens. bcrypt won't work for lookup since we can't query by it.
// 
// Approach: Use a SHA-256 hash of the token for lookup/grouping, and store that.
// This way we never store plaintext tokens but can still match them.

const crypto = require('crypto');

function hashToken(token) {
  const secret = process.env.APP_SECRET || 'default-secret';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || typeof serviceId !== 'string' || !token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token are required strings.' });
    }

    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)
       ON CONFLICT(serviceId, tokenHash) DO UPDATE SET lastNotification = excluded.lastNotification`,
      [serviceId, tokenHash, now],
      function (err) {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).json({ error: 'Internal server error.' });
        }
        return res.status(200).json({ message: 'Heartbeat registered successfully.' });
      }
    );
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(500).json({ error: 'Internal server error.' });
    }

    const tokenHash = hashToken(token);

    db.all(
      `SELECT serviceId, lastNotification FROM services WHERE tokenHash = ?`,
      [tokenHash],
      (err, rows) => {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).json({ error: 'Internal server error.' });
        }
        const result = (rows || []).map(row => ({
          serviceId: row.serviceId,
          lastNotification: row.lastNotification
        }));
        return res.status(200).json(result);
      }
    );
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Service Monitoring API running on http://0.0.0.0:5000');
});