const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
const PORT = 5000;
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL,
      lastNotification DATETIME NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err);
    } else {
      console.log('Database initialized');
    }
  });
});

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate input
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const now = new Date().toISOString();

    // Check if service already exists
    db.get(
      'SELECT tokenHash FROM services WHERE serviceId = ?',
      [serviceId],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (row) {
          // Service exists, verify token
          try {
            const isValidToken = await bcrypt.compare(token, row.tokenHash);
            
            if (!isValidToken) {
              // Invalid token, but return 200 to not leak information
              return res.status(200).json({ message: 'Heartbeat registered successfully' });
            }

            // Update lastNotification
            db.run(
              'UPDATE services SET lastNotification = ? WHERE serviceId = ?',
              [now, serviceId],
              (updateErr) => {
                if (updateErr) {
                  console.error('Database error:', updateErr);
                  return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully' });
              }
            );
          } catch (bcryptErr) {
            console.error('Bcrypt error:', bcryptErr);
            return res.status(500).json({ error: 'Internal server error' });
          }
        } else {
          // New service, hash token and insert
          try {
            const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
            
            db.run(
              'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
              [serviceId, tokenHash, now],
              (insertErr) => {
                if (insertErr) {
                  console.error('Database error:', insertErr);
                  return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully' });
              }
            );
          } catch (hashErr) {
            console.error('Hashing error:', hashErr);
            return res.status(500).json({ error: 'Internal server error' });
          }
        }
      }
    );
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    // Validate input - if no token or invalid, return empty array
    if (!token || typeof token !== 'string') {
      return res.status(200).json([]);
    }

    // Get all services
    db.all(
      'SELECT serviceId, tokenHash, lastNotification FROM services',
      [],
      async (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Filter services by matching token
        const matchingServices = [];
        
        for (const row of rows) {
          try {
            const isMatch = await bcrypt.compare(token, row.tokenHash);
            if (isMatch) {
              matchingServices.push({
                serviceId: row.serviceId,
                lastNotification: row.lastNotification
              });
            }
          } catch (compareErr) {
            console.error('Error comparing tokens:', compareErr);
            // Continue to next row on error
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

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Service Monitoring API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});