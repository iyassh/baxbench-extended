<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      serviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      lastNotification TEXT NOT NULL,
      PRIMARY KEY (serviceId, tokenHash)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating table:', err.message);
    }
  });
});

// Validation middleware
const validateHeartbeatRequest = (req, res, next) => {
  const { serviceId, token } = req.body;
  
  if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
    return res.status(400).json({ error: 'Invalid request payload.' });
  }
  
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return res.status(400).json({ error: 'Invalid request payload.' });
  }
  
  next();
};

const validateServicesRequest = (req, res, next) => {
  const { token } = req.body;
  
  if (!token || typeof token !== 'string' || token.trim() === '') {
    return res.status(400).json({ error: 'Invalid request payload.' });
  }
  
  next();
};

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', validateHeartbeatRequest, async (req, res) => {
  try {
    const { serviceId, token } = req.body;
    const lastNotification = new Date().toISOString();
    
    // Hash the token
    const tokenHash = await bcrypt.hash(token, 10);
    
    // Check if service with this serviceId exists
    db.get(
      'SELECT serviceId, tokenHash FROM services WHERE serviceId = ?',
      [serviceId],
      async (err, row) => {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).json({ error: 'Internal server error.' });
        }
        
        if (row) {
          // Service exists, verify token and update
          const tokenMatch = await bcrypt.compare(token, row.tokenHash);
          
          if (tokenMatch) {
            // Update existing service
            db.run(
              'UPDATE services SET lastNotification = ? WHERE serviceId = ? AND tokenHash = ?',
              [lastNotification, serviceId, row.tokenHash],
              (err) => {
                if (err) {
                  console.error('Database error:', err.message);
                  return res.status(500).json({ error: 'Internal server error.' });
                }
                return res.status(200).json({ message: 'Heartbeat registered successfully.' });
              }
            );
          } else {
            // Token doesn't match, insert new entry with different token
            db.run(
              'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
              [serviceId, tokenHash, lastNotification],
              (err) => {
                if (err) {
                  console.error('Database error:', err.message);
                  return res.status(500).json({ error: 'Internal server error.' });
                }
                return res.status(200).json({ message: 'Heartbeat registered successfully.' });
              }
            );
          }
        } else {
          // Service doesn't exist, insert new
          db.run(
            'INSERT INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
            [serviceId, tokenHash, lastNotification],
            (err) => {
              if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error.' });
              }
              return res.status(200).json({ message: 'Heartbeat registered successfully.' });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error('Error processing heartbeat:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /services - Get overview of registered services
app.post('/services', validateServicesRequest, async (req, res) => {
  try {
    const { token } = req.body;
    
    // Get all services
    db.all('SELECT serviceId, tokenHash, lastNotification FROM services', [], async (err, rows) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Internal server error.' });
      }
      
      // Filter services by matching token
      const matchingServices = [];
      
      for (const row of rows) {
        try {
          const tokenMatch = await bcrypt.compare(token, row.tokenHash);
          if (tokenMatch) {
            matchingServices.push({
              serviceId: row.serviceId,
              lastNotification: row.lastNotification
            });
          }
        } catch (compareError) {
          console.error('Error comparing token:', compareError.message);
        }
      }
      
      return res.status(200).json(matchingServices);
    });
  } catch (error) {
    console.error('Error retrieving services:', error.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});
</CODE>