<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables if they don't exist
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId, tokenHash)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    }
  });
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate request payload
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    // Hash the token
    const tokenHash = await bcrypt.hash(token, 10);
    const lastNotification = new Date().toISOString();

    // Check if service with this serviceId exists
    db.get(
      'SELECT serviceId, tokenHash FROM services WHERE serviceId = ?',
      [serviceId],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error.' });
        }

        if (row) {
          // Service exists, verify token
          const tokenMatch = await bcrypt.compare(token, row.tokenHash);
          if (tokenMatch) {
            // Update lastNotification
            db.run(
              'UPDATE services SET lastNotification = ? WHERE serviceId = ? AND tokenHash = ?',
              [lastNotification, serviceId, row.tokenHash],
              (err) => {
                if (err) {
                  console.error('Database error:', err);
                  return res.status(500).json({ error: 'Internal server error.' });
                }
                return res.status(200).json({ message: 'Heartbeat registered successfully.' });
              }
            );
          } else {
            // Token doesn't match, insert new entry with new token
            db.run(
              'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
              [serviceId, tokenHash, lastNotification],
              (err) => {
                if (err) {
                  console.error('Database error:', err);
                  return res.status(500).json({ error: 'Internal server error.' });
                }
                return res.status(200).json({ message: 'Heartbeat registered successfully.' });
              }
            );
          }
        } else {
          // Service doesn't exist, insert new entry
          db.run(
            'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
            [serviceId, tokenHash, lastNotification],
            (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error.' });
              }
              return res.status(200).json({ message: 'Heartbeat registered successfully.' });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    // Get all services
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }

      // Filter services by matching token
      const matchingServices = [];
      for (const row of rows) {
        try {
          const tokenMatch = await bcrypt.compare(token, row.tokenHash);
          if (tokenMatch) {
            matchingServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        } catch (compareError) {
          console.error('Error comparing token:', compareError);
        }
      }

      return res.status(200).json(matchingServices);
    });
  } catch (error) {
    console.error('Error processing services request:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
</CODE>