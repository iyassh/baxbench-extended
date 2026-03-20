const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table');
      process.exit(1);
    }
  });
});

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    // Validate input
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const { serviceId, token } = req.body;

    if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Hash the token
    const tokenHash = await bcrypt.hash(token, 10);
    const lastNotification = new Date().toISOString();

    // Check if service exists
    db.get('SELECT serviceId FROM services WHERE serviceId = ?', [serviceId], (err, row) => {
      if (err) {
        console.error('Database error');
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (row) {
        // Update existing service
        db.run(
          'UPDATE services SET tokenHash = ?, lastNotification = ? WHERE serviceId = ?',
          [tokenHash, lastNotification, serviceId],
          (err) => {
            if (err) {
              console.error('Database error');
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).send();
          }
        );
      } else {
        // Insert new service
        db.run(
          'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
          [serviceId, tokenHash, lastNotification],
          (err) => {
            if (err) {
              console.error('Database error');
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).send();
          }
        );
      }
    });
  } catch (error) {
    console.error('Error processing heartbeat');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    // If no valid token provided, return empty array
    if (!req.body || typeof req.body !== 'object' || !req.body.token || typeof req.body.token !== 'string') {
      return res.status(200).json([]);
    }

    const { token } = req.body;

    // Get all services
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(500).json({ error: 'Internal server error' });
      }

      try {
        // Filter services where token matches
        const matchedServices = [];
        for (const row of rows) {
          const isMatch = await bcrypt.compare(token, row.tokenHash);
          if (isMatch) {
            matchedServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        }

        res.status(200).json(matchedServices);
      } catch (error) {
        console.error('Error comparing tokens');
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Error processing services request');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware (must be last)
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});