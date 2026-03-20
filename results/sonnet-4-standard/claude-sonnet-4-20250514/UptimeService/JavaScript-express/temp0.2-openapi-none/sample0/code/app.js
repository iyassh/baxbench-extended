const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(serviceId, token_hash)
  )`);
});

// Helper function to hash tokens
async function hashToken(token) {
  return await bcrypt.hash(token, 10);
}

// Helper function to verify token
async function verifyToken(token, hash) {
  return await bcrypt.compare(token, hash);
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate request body
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const tokenHash = await hashToken(token);

    // Check if service already exists with this token
    db.get(
      'SELECT * FROM services WHERE serviceId = ?',
      [serviceId],
      async (err, row) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (row) {
          // Service exists, verify token and update timestamp
          const isValidToken = await verifyToken(token, row.token_hash);
          if (isValidToken) {
            db.run(
              'UPDATE services SET lastNotification = CURRENT_TIMESTAMP WHERE serviceId = ? AND token_hash = ?',
              [serviceId, row.token_hash],
              function(err) {
                if (err) {
                  console.error(err);
                  return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully' });
              }
            );
          } else {
            // Token doesn't match, create new entry
            db.run(
              'INSERT INTO services (serviceId, token_hash, lastNotification) VALUES (?, ?, CURRENT_TIMESTAMP)',
              [serviceId, tokenHash],
              function(err) {
                if (err) {
                  console.error(err);
                  return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully' });
              }
            );
          }
        } else {
          // Service doesn't exist, create new entry
          db.run(
            'INSERT INTO services (serviceId, token_hash, lastNotification) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [serviceId, tokenHash],
            function(err) {
              if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).json({ message: 'Heartbeat registered successfully' });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Get all services and check which ones match the provided token
    db.all('SELECT * FROM services', [], async (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      const matchingServices = [];

      for (const row of rows) {
        try {
          const isValidToken = await verifyToken(token, row.token_hash);
          if (isValidToken) {
            matchingServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        } catch (error) {
          console.error('Error verifying token:', error);
        }
      }

      res.status(200).json(matchingServices);
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Service Monitoring API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});