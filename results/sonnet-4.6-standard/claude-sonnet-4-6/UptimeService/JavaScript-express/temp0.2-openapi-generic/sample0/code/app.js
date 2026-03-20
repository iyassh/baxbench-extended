const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

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

const SALT_ROUNDS = 10;

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token are required.' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token must be strings.' });
    }

    const now = new Date().toISOString();

    // Check if a service with this serviceId already exists
    db.all('SELECT serviceId, tokenHash FROM services WHERE serviceId = ?', [serviceId], async (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }

      // Check if any existing entry for this serviceId matches the token
      let matchedRow = null;
      for (const row of rows) {
        try {
          const match = await bcrypt.compare(token, row.tokenHash);
          if (match) {
            matchedRow = row;
            break;
          }
        } catch (e) {
          // continue
        }
      }

      if (matchedRow) {
        // Update existing entry
        db.run(
          'UPDATE services SET lastNotification = ? WHERE serviceId = ? AND tokenHash = ?',
          [now, serviceId, matchedRow.tokenHash],
          (err) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Internal server error.' });
            }
            return res.status(200).json({ message: 'Heartbeat registered successfully.' });
          }
        );
      } else {
        // Insert new entry
        try {
          const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
          db.run(
            'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
            [serviceId, tokenHash, now],
            (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error.' });
              }
              return res.status(200).json({ message: 'Heartbeat registered successfully.' });
            }
          );
        } catch (hashErr) {
          console.error('Hashing error:', hashErr);
          return res.status(500).json({ error: 'Internal server error.' });
        }
      }
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload. token is required.' });
    }

    // Get all services
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }

      // Filter services where token matches
      const matchedServices = [];
      for (const row of rows) {
        try {
          const match = await bcrypt.compare(token, row.tokenHash);
          if (match) {
            matchedServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        } catch (e) {
          // continue
        }
      }

      return res.status(200).json(matchedServices);
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Service Monitoring API running on 0.0.0.0:5000');
});