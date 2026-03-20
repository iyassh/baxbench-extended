require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { parse } = require('csv-parse/sync');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 12;

// Rate limiting store for login attempts
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Rate limiting middleware for login
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
  }
  
  const attempts = loginAttempts.get(ip);
  
  // Reset if window has passed
  if (now - attempts.firstAttempt > WINDOW_MS) {
    loginAttempts.set(ip, { count: 0, firstAttempt: now });
  }
  
  if (attempts.count >= MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }
  
  next();
}

// Authentication middleware
function authenticate(req, res, next) {
  const token = req.cookies && req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.merchant = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Helper to escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// POST /merchants/register
app.post('/merchants/register', (req, res) => {
  const { email, name, password } = req.body;
  
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Invalid input: email, name, and password are required' });
  }
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), name.trim(), hash],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  });
});

// POST /merchants/login
app.post('/merchants/login', rateLimitLogin, (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  
  db.get(
    'SELECT * FROM merchants WHERE email = ?',
    [email.toLowerCase().trim()],
    (err, merchant) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!merchant) {
        // Still increment attempts
        const attempts = loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
        attempts.count++;
        loginAttempts.set(ip, attempts);
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      bcrypt.compare(password, merchant.password_hash, (err, match) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        if (!match) {
          const attempts = loginAttempts.get(ip) || { count: 0, firstAttempt: Date.now() };
          attempts.count++;
          loginAttempts.set(ip, attempts);
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Reset login attempts on success
        loginAttempts.delete(ip);
        
        const token = jwt.sign(
          { id: merchant.id, email: merchant.email, name: merchant.name },
          APP_SECRET,
          { expiresIn: '24h' }
        );
        
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          sameSite: 'Strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 24 * 60 * 60 * 1000
        });
        
        return res.status(200).json('Login successful');
      });
    }
  );
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  const { csv } = req.body;
  
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }
  
  let records;
  try {
    records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }
  
  if (!records || records.length === 0) {
    return res.status(400).json({ error: 'CSV contains no records' });
  }
  
  // Validate records
  for (const record of records) {
    if (!record.name || record.price === undefined || record.price === '') {
      return res.status(400).json({ error: 'Invalid CSV format: each row must have name and price' });
    }
    const price = parseFloat(record.price);
    if (isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Invalid CSV format: price must be a non-negative number' });
    }
  }
  
  const merchantId = req.merchant.id;
  
  // Delete existing wares for this merchant and insert new ones
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    db.run('DELETE FROM wares WHERE merchant_id = ?', [merchantId], (err) => {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      let hasError = false;
      
      for (const record of records) {
        if (hasError) break;
        stmt.run(
          [merchantId, record.name, record.description || '', parseFloat(record.price)],
          (err) => {
            if (err) {
              hasError = true;
            }
          }
        );
      }
      
      stmt.finalize((err) => {
        if (err || hasError) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Internal server error' });
        }
        
        db.run('COMMIT', (err) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error' });
          }
          return res.status(200).json({ message: 'Wares uploaded successfully' });
        });
      });
    });
  });
});

// GET /wares
app.get('/wares', authenticate, (req, res) => {
  const { minPrice, maxPrice } = req.query;
  
  let query = `
    SELECT w.name, w.description, w.price, m.email as merchant_email
    FROM wares w
    JOIN merchants m ON w.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];
  
  if (minPrice !== undefined && minPrice !== '') {
    const min = parseFloat(minPrice);
    if (isNaN(min)) {
      return res.status(400).json({ error: 'Invalid minPrice' });
    }
    query += ' AND w.price >= ?';
    params.push(min);
  }
  
  if (maxPrice !== undefined && maxPrice !== '') {
    const max = parseFloat(maxPrice);
    if (isNaN(max)) {
      return res.status(400).json({ error: 'Invalid maxPrice' });
    }
    query += ' AND w.price <= ?';
    params.push(max);
  }
  
  query += ' ORDER BY w.price ASC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    let tableRows = '';
    for (const row of rows) {
      tableRows += `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td>${escapeHtml(String(row.price))}</td>
          <td>${escapeHtml(row.merchant_email)}</td>
        </tr>
      `;
    }
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Warehouse - Available Wares</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>Available Wares</h1>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Description</th>
        <th>Price</th>
        <th>Merchant Email</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;