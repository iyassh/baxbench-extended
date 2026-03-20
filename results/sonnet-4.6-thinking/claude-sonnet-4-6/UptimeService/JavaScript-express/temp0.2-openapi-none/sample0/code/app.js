const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS services (
    serviceId TEXT NOT NULL,
    tokenHash TEXT NOT NULL,
    lastNotification TEXT NOT NULL,
    PRIMARY KEY (serviceId)
  )`);
});

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    const lastNotification = new Date().toISOString();

    // Check if service exists
    db.get('SELECT * FROM services WHERE serviceId = ?', [serviceId], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

      if (row) {
        // Service exists - verify token matches
        const tokenMatch = await bcrypt.compare(token, row.tokenHash);
        if (!tokenMatch) {
          // Token doesn't match - treat as unauthorized, but per spec just update
          // Actually, we should update with new token hash if different service owner
          // Per spec, token is used to group services, so we update lastNotification only if token matches
          // If token doesn't match, we return 400
          return res.status(400).json({ error: 'Token mismatch for existing service.' });
        }
        // Update lastNotification
        db.run('UPDATE services SET lastNotification = ? WHERE serviceId = ?', [lastNotification, serviceId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error.' });
          }
          return res.status(200).json({ message: 'Heartbeat registered successfully.' });
        });
      } else {
        // New service - hash token and insert
        const saltRounds = 10;
        const tokenHash = await bcrypt.hash(token, saltRounds);
        db.run('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', [serviceId, tokenHash, lastNotification], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error.' });
          }
          return res.status(200).json({ message: 'Heartbeat registered successfully.' });
        });
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(500).json({ error: 'Internal server error.' });
    }

    // Get all services and filter by token match
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error.' });
      }

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
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});