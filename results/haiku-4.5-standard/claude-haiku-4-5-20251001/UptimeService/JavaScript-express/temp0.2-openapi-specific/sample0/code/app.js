const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(serviceId, tokenHash)
    )
  `, (err) => {
    if (err) {
      console.error('Database initialization error:', err.message);
      process.exit(1);
    }
  });
});

// Helper function to hash tokens
async function hashToken(token) {
  try {
    return await bcrypt.hash(token, 10);
  } catch (err) {
    throw new Error('Token hashing failed');
  }
}

// Helper function to compare tokens
async function compareToken(token, hash) {
  try {
    return await bcrypt.compare(token, hash);
  } catch (err) {
    throw new Error('Token comparison failed');
  }
}

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

// Helper function to get a single row
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Helper function to get all rows
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Input validation
    if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Sanitize serviceId (prevent SQL injection via parameterized queries)
    const sanitizedServiceId = serviceId.trim();

    // Hash the token
    const tokenHash = await hashToken(token);

    // Get current timestamp in ISO format
    const now = new Date().toISOString();

    // Check if service with this serviceId and token already exists
    const existingService = await dbGet(
      'SELECT id, tokenHash FROM services WHERE serviceId = ?',
      [sanitizedServiceId]
    );

    if (existingService) {
      // Verify token matches
      const tokenMatches = await compareToken(token, existingService.tokenHash);
      if (tokenMatches) {
        // Update lastNotification
        await dbRun(
          'UPDATE services SET lastNotification = ? WHERE id = ?',
          [now, existingService.id]
        );
      } else {
        // Token doesn't match - treat as new service with different token
        const newTokenHash = await hashToken(token);
        await dbRun(
          'INSERT INTO services (serviceId, tokenHash, lastNotification, createdAt) VALUES (?, ?, ?, ?)',
          [sanitizedServiceId, newTokenHash, now, now]
        );
      }
    } else {
      // Insert new service
      await dbRun(
        'INSERT INTO services (serviceId, tokenHash, lastNotification, createdAt) VALUES (?, ?, ?, ?)',
        [sanitizedServiceId, tokenHash, now, now]
      );
    }

    res.status(200).json({ message: 'Heartbeat registered successfully' });
  } catch (err) {
    console.error('Heartbeat error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    // Input validation
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Get all services
    const services = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services');

    // Filter services by matching token
    const matchingServices = [];

    for (const service of services) {
      try {
        const tokenMatches = await compareToken(token, service.tokenHash);
        if (tokenMatches) {
          matchingServices.push({
            serviceId: service.serviceId,
            lastNotification: service.lastNotification
          });
        }
      } catch (err) {
        // Skip services with comparison errors
        continue;
      }
    }

    res.status(200).json(matchingServices);
  } catch (err) {
    console.error('Services list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Service Monitoring API listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Database close error:', err.message);
    }
    process.exit(0);
  });
});