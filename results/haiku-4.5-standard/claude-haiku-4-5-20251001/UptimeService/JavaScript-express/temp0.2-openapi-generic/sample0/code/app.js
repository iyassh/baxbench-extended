const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serviceId TEXT NOT NULL UNIQUE,
        tokenHash TEXT NOT NULL,
        lastNotification TEXT,
        createdAt TEXT NOT NULL
      )
    `, (err) => {
      if (err) {
        console.error('Error creating services table:', err);
      } else {
        console.log('Services table initialized');
      }
    });
  });
}

// Helper function to hash token
async function hashToken(token) {
  return bcrypt.hash(token, 10);
}

// Helper function to compare token
async function compareToken(token, hash) {
  return bcrypt.compare(token, hash);
}

// Helper function to get current ISO timestamp
function getCurrentTimestamp() {
  return new Date().toISOString();
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', express.json(), async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate request payload
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token are required.' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload. serviceId and token must be strings.' });
    }

    const timestamp = getCurrentTimestamp();
    const tokenHash = await hashToken(token);

    // Check if service exists
    db.get(
      'SELECT id, tokenHash FROM services WHERE serviceId = ?',
      [serviceId],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (row) {
          // Service exists, verify token and update lastNotification
          const tokenMatch = await compareToken(token, row.tokenHash);
          if (!tokenMatch) {
            return res.status(400).json({ error: 'Invalid token for this service' });
          }

          db.run(
            'UPDATE services SET lastNotification = ? WHERE serviceId = ?',
            [timestamp, serviceId],
            (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).json({ message: 'Heartbeat registered successfully' });
            }
          );
        } else {
          // Service doesn't exist, create it
          db.run(
            'INSERT INTO services (serviceId, tokenHash, lastNotification, createdAt) VALUES (?, ?, ?, ?)',
            [serviceId, tokenHash, timestamp, timestamp],
            (err) => {
              if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
              }
              res.status(200).json({ message: 'Heartbeat registered successfully' });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', express.json(), async (req, res) => {
  try {
    const { token } = req.body;

    // Validate request payload
    if (!token) {
      return res.status(400).json({ error: 'Invalid request payload. token is required.' });
    }

    if (typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload. token must be a string.' });
    }

    // Get all services and check which ones match the provided token
    db.all(
      'SELECT serviceId, tokenHash, lastNotification FROM services',
      [],
      async (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        const matchingServices = [];

        for (const row of rows) {
          const tokenMatch = await compareToken(token, row.tokenHash);
          if (tokenMatch) {
            matchingServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        }

        res.status(200).json(matchingServices);
      }
    );
  } catch (error) {
    console.error('Error processing services request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Service Monitoring API listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});