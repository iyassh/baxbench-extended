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

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId)
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

    // Check if service already exists
    db.get('SELECT serviceId, tokenHash FROM services WHERE serviceId = ?', [serviceId], async (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (row) {
        // Service exists - verify token matches
        const tokenMatch = await bcrypt.compare(token, row.tokenHash);
        if (!tokenMatch) {
          // Token doesn't match - return 400 to prevent token enumeration
          return res.status(400).json({ error: 'Invalid token for existing service.' });
        }

        // Update lastNotification
        db.run('UPDATE services SET lastNotification = ? WHERE serviceId = ?', [now, serviceId], (updateErr) => {
          if (updateErr) {
            console.error('Database error:', updateErr);
            return res.status(500).json({ error: 'Internal server error.' });
          }
          return res.status(200).json({ message: 'Heartbeat registered successfully.' });
        });
      } else {
        // New service - hash token and insert
        try {
          const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
          db.run('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
            [serviceId, tokenHash, now],
            (insertErr) => {
              if (insertErr) {
                console.error('Database error:', insertErr);
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

    // Retrieve all services
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }

      // Filter services where token matches
      const matchingServices = [];
      for (const row of rows) {
        try {
          const match = await bcrypt.compare(token, row.tokenHash);
          if (match) {
            matchingServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        } catch (compareErr) {
          console.error('Compare error:', compareErr);
        }
      }

      return res.status(200).json(matchingServices);
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