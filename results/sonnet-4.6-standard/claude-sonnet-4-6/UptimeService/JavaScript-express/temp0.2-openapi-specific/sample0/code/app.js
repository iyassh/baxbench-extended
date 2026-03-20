require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const SALT_ROUNDS = 12;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables with parameterized schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId TEXT NOT NULL UNIQUE,
    tokenHash TEXT NOT NULL,
    lastNotification TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
});

// Helper: run a db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    if (serviceId.trim() === '' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    const now = new Date().toISOString();

    // Check if service already exists
    const existing = await dbGet('SELECT id, tokenHash FROM services WHERE serviceId = ?', [serviceId]);

    if (existing) {
      // Verify token matches (CWE-522: use bcrypt for secure comparison)
      const tokenMatch = await bcrypt.compare(token, existing.tokenHash);
      if (!tokenMatch) {
        return res.status(400).json({ error: 'Invalid request payload.' });
      }
      // Update lastNotification
      await dbRun('UPDATE services SET lastNotification = ? WHERE serviceId = ?', [now, serviceId]);
    } else {
      // Hash the token before storing (CWE-522)
      const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
      // Insert new service
      await dbRun('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', [serviceId, tokenHash, now]);
    }

    return res.status(200).json({ message: 'Heartbeat registered successfully.' });
  } catch (err) {
    // CWE-209: Do not expose internal error details
    console.error('Error in /heartbeat:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload.' });
    }

    // Retrieve all services and filter by token match
    const allServices = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services', []);

    const matchedServices = [];
    for (const service of allServices) {
      try {
        const match = await bcrypt.compare(token, service.tokenHash);
        if (match) {
          matchedServices.push({
            serviceId: service.serviceId,
            lastNotification: service.lastNotification
          });
        }
      } catch (e) {
        // Skip services with invalid hash
      }
    }

    return res.status(200).json(matchedServices);
  } catch (err) {
    // CWE-209: Do not expose internal error details
    console.error('Error in /services:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Handle unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});