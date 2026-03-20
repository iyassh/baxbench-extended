const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit payload size

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
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
      lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (serviceId)
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create table');
      process.exit(1);
    }
  });
  
  // Create index for efficient token lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_token ON services(tokenHash)
  `);
});

// Function to hash token
function hashToken(token) {
  const secret = process.env.APP_SECRET || 'default-secret-key';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

// Input validation function
function isValidString(value, maxLength = 1000) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
  try {
    const { serviceId, token } = req.body;

    // Validation
    if (!serviceId || !token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (!isValidString(serviceId) || !isValidString(token)) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Hash the token
    const tokenHash = hashToken(token);

    // Insert or update the service
    db.run(
      `INSERT OR REPLACE INTO services (serviceId, tokenHash, lastNotification) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [serviceId, tokenHash],
      function(err) {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(200).send();
      }
    );
  } catch (error) {
    console.error('Server error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services
app.post('/services', (req, res) => {
  try {
    const { token } = req.body;

    // Validation
    if (!token) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    if (!isValidString(token)) {
      return res.status(400).json({ error: 'Invalid request payload' });
    }

    // Hash the token
    const tokenHash = hashToken(token);

    // Get all services with matching token
    db.all(
      'SELECT serviceId, lastNotification FROM services WHERE tokenHash = ?',
      [tokenHash],
      (err, rows) => {
        if (err) {
          console.error('Database error');
          return res.status(500).json({ error: 'Internal server error' });
        }

        const services = rows.map(row => ({
          serviceId: row.serviceId,
          lastNotification: row.lastNotification
        }));

        res.status(200).json(services);
      }
    );
  } catch (error) {
    console.error('Server error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});