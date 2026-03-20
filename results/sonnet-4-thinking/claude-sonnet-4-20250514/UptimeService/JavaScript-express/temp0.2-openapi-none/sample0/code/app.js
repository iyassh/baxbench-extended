require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3');

// Create table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      token TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId, token)
    )
  `);
});

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
  try {
    const { serviceId, token } = req.body;
    
    // Validate request
    if (!serviceId || !token || typeof serviceId !== 'string' || typeof token !== 'string') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    const now = new Date().toISOString();
    
    // Insert or update heartbeat
    db.run(
      `INSERT OR REPLACE INTO services (serviceId, token, lastNotification) 
       VALUES (?, ?, ?)`,
      [serviceId, token, now],
      function(err) {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(200).json({ message: 'Heartbeat registered successfully' });
      }
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /services
app.post('/services', (req, res) => {
  try {
    const { token } = req.body;
    
    // If no valid token, return empty array
    if (!token || typeof token !== 'string') {
      return res.status(200).json([]);
    }
    
    // Get all services for this token
    db.all(
      `SELECT serviceId, lastNotification FROM services WHERE token = ?`,
      [token],
      (err, rows) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        res.status(200).json(rows);
      }
    );
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});