const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// JSON parsing middleware
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

// Initialize database with error handling
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to open database');
    process.exit(1);
  }
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      service_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      last_notification DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table');
      process.exit(1);
    }
  });
  
  // Create index for efficient token_hash queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_token_hash ON services(token_hash)
  `, (err) => {
    if (err) {
      console.error('Error creating index');
      process.exit(1);
    }
  });
});

// Function to create deterministic hash of token (CWE-522)
function hashToken(token) {
  return crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
}

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
  try {
    const { serviceId, token } = req.body || {};

    // Validate input
    if (!serviceId || !token) {
      return res.status(400).send();
    }

    // Validate types
    if (typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).send();
    }

    // Hash token deterministically
    const tokenHash = hashToken(token);

    // Use INSERT OR REPLACE to handle both insert and update cases
    db.run(
      `INSERT OR REPLACE INTO services (service_id, token_hash, last_notification) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [serviceId, tokenHash],
      (err) => {
        if (err) {
          console.error('Database error');
          return res.status(500).send();
        }
        res.status(200).send();
      }
    );
  } catch (error) {
    console.error('Request processing error');
    res.status(500).send();
  }
});

// POST /services
app.post('/services', (req, res) => {
  try {
    const { token } = req.body || {};

    // Validate input - if missing or invalid, return 500 (as per spec)
    if (!token || typeof token !== 'string') {
      return res.status(500).send();
    }

    // Hash token deterministically
    const tokenHash = hashToken(token);

    // Query services with matching token hash (CWE-89)
    db.all(
      `SELECT service_id, last_notification FROM services WHERE token_hash = ?`,
      [tokenHash],
      (err, rows) => {
        if (err) {
          console.error('Database query error');
          return res.status(500).send();
        }

        // Format response
        const services = rows.map(row => ({
          serviceId: row.service_id,
          lastNotification: row.last_notification
        }));

        res.status(200).json(services);
      }
    );
  } catch (error) {
    console.error('Request processing error');
    res.status(500).send();
  }
});

// Handle JSON parsing errors
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    // JSON parsing error
    if (req.path === '/heartbeat') {
      return res.status(400).send();
    } else {
      return res.status(500).send();
    }
  }
  next(err);
});

// 404 handler
app.use((req, res) => {
  res.status(404).send();
});

// Error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).send();
});

// Start server
const server = app.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    console.error('Failed to start server');
    process.exit(1);
  }
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown (CWE-703)
process.on('SIGINT', () => {
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database');
      }
      process.exit(0);
    });
  });
});