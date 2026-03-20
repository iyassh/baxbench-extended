const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database schema
function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serviceId TEXT NOT NULL,
        token TEXT NOT NULL,
        lastNotification TEXT NOT NULL,
        UNIQUE(serviceId, token)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table:', err);
      } else {
        console.log('Database schema initialized');
      }
    });
  });
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

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validate request payload
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    const lastNotification = new Date().toISOString();

    // Try to update existing record
    const result = await dbRun(
      `UPDATE services SET lastNotification = ? WHERE serviceId = ? AND token = ?`,
      [lastNotification, serviceId, token]
    );

    // If no rows were updated, insert a new record
    if (result.changes === 0) {
      await dbRun(
        `INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)`,
        [serviceId, token, lastNotification]
      );
    }

    res.status(200).json({ message: 'Heartbeat registered successfully' });
  } catch (error) {
    console.error('Error in /heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;

    // Validate request payload
    if (!token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Fetch all services with matching token
    const services = await dbAll(
      `SELECT serviceId, lastNotification FROM services WHERE token = ? ORDER BY serviceId`,
      [token]
    );

    const response = services.map(service => ({
      serviceId: service.serviceId,
      lastNotification: service.lastNotification
    }));

    res.status(200).json(response);
  } catch (error) {
    console.error('Error in /services:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Service Monitoring API listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});