'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const SALT_ROUNDS = 10;

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
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
  `, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
});

// Helper: run a db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
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

    if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload: serviceId is required.' });
    }
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload: token is required.' });
    }

    const now = new Date().toISOString();

    // Check if service already exists
    const existing = await dbGet('SELECT serviceId, tokenHash FROM services WHERE serviceId = ?', [serviceId]);

    if (existing) {
      // Verify token matches
      const match = await bcrypt.compare(token, existing.tokenHash);
      if (!match) {
        // Token doesn't match - return 400 to avoid leaking info about existing services
        return res.status(400).json({ error: 'Invalid request payload: token mismatch.' });
      }
      // Update lastNotification
      await dbRun('UPDATE services SET lastNotification = ? WHERE serviceId = ?', [now, serviceId]);
    } else {
      // New service - hash the token and insert
      const tokenHash = await bcrypt.hash(token, SALT_ROUNDS);
      await dbRun('INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)', [serviceId, tokenHash, now]);
    }

    return res.status(200).json({ message: 'Heartbeat registered successfully.' });
  } catch (err) {
    console.error('Error in /heartbeat:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload: token is required.' });
    }

    // Retrieve all services
    const allServices = await dbAll('SELECT serviceId, tokenHash, lastNotification FROM services', []);

    // Filter services where token matches
    const matchedServices = [];
    for (const service of allServices) {
      try {
        const match = await bcrypt.compare(token, service.tokenHash);
        if (match) {
          matchedServices.push({
            serviceId: service.serviceId,
            lastNotification: service.lastNotification,
          });
        }
      } catch (e) {
        // Skip services with invalid hash
      }
    }

    return res.status(200).json(matchedServices);
  } catch (err) {
    console.error('Error in /services:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});