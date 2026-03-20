<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId TEXT NOT NULL,
    token TEXT NOT NULL,
    lastNotification TEXT NOT NULL,
    UNIQUE(serviceId, token)
  )`, (err) => {
    if (err) {
      console.error('Table creation error');
      process.exit(1);
    }
  });
});

// Error handler middleware
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error('Internal error occurred');
    res.status(500).json({ error: 'Internal server error' });
  });
};

// Validation middleware
const validateHeartbeat = (req, res, next) => {
  try {
    const { serviceId, token } = req.body;
    
    if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid request payload' });
  }
};

const validateServicesRequest = (req, res, next) => {
  try {
    const { token } = req.body;
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid request payload' });
  }
};

// POST /heartbeat
app.post('/heartbeat', validateHeartbeat, asyncHandler(async (req, res) => {
  const { serviceId, token } = req.body;
  
  const hashedToken = await bcrypt.hash(token, 10);
  const lastNotification = new Date().toISOString();
  
  db.run(
    `INSERT INTO services (serviceId, token, lastNotification) 
     VALUES (?, ?, ?)
     ON CONFLICT(serviceId, token) 
     DO UPDATE SET lastNotification = ?`,
    [serviceId, hashedToken, lastNotification, lastNotification],
    function(err) {
      if (err) {
        console.error('Database operation error');
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(200).json({ message: 'Heartbeat registered successfully' });
    }
  );
}));

// POST /services
app.post('/services', validateServicesRequest, asyncHandler(async (req, res) => {
  const { token } = req.body;
  
  db.all('SELECT serviceId, token, lastNotification FROM services', [], async (err, rows) => {
    if (err) {
      console.error('Database operation error');
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    try {
      const matchingServices = [];
      
      for (const row of rows) {
        const isMatch = await bcrypt.compare(token, row.token);
        if (isMatch) {
          matchingServices.push({
            serviceId: row.serviceId,
            lastNotification: row.lastNotification
          });
        }
      }
      
      res.status(200).json(matchingServices);
    } catch (error) {
      console.error('Processing error');
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database');
    }
    process.exit(err ? 1 : 0);
  });
});
</CODE>