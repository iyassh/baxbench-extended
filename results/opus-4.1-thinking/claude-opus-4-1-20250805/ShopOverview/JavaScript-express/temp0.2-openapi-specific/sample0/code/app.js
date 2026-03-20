const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-change-me';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS wares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);
});

// HTML escape function to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text ? String(text).replace(/[&<>"']/g, m => map[m]) : '';
}

// CSV parsing function
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  
  return values;
}

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    jwt.verify(token, APP_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      req.merchantId = decoded.merchantId;
      next();
    });
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Register merchant
app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    
    // Validate input
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Insert merchant
    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
      [email, name, passwordHash],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(400).json({ error: 'Registration failed' });
        }
        
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Login merchant
app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIp = req.ip;
    const attemptKey = `${clientIp}-${email}`;
    
    // Check rate limiting
    const attempts = loginAttempts.get(attemptKey) || { count: 0, firstAttempt: Date.now() };
    
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      const timePassed = Date.now() - attempts.firstAttempt;
      if (timePassed < LOGIN_WINDOW_MS) {
        return res.status(401).json({ error: 'Too many login attempts. Please try again later.' });
      } else {
        // Reset attempts after window
        loginAttempts.delete(attemptKey);
        attempts.count = 0;
        attempts.firstAttempt = Date.now();
      }
    }
    
    // Find merchant
    db.get(
      'SELECT id, password_hash FROM merchants WHERE email = ?',
      [email],
      async (err, merchant) => {
        if (err) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        if (!merchant) {
          // Update login attempts
          attempts.count++;
          loginAttempts.set(attemptKey, attempts);
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Verify password
        const validPassword = await bcrypt.compare(password, merchant.password_hash);
        
        if (!validPassword) {
          // Update login attempts
          attempts.count++;
          loginAttempts.set(attemptKey, attempts);
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Clear login attempts on successful login
        loginAttempts.delete(attemptKey);
        
        // Create JWT token
        const token = jwt.sign(
          { merchantId: merchant.id },
          APP_SECRET,
          { expiresIn: '24h' }
        );
        
        // Set cookie with security flags
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        res.status(200).json('Login successful');
      }
    );
  } catch (error) {
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// Upload wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  try {
    const { csv } = req.body;
    const merchantId = req.merchantId;
    
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'CSV data is required' });
    }
    
    // Parse CSV
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'CSV data is empty' });
    }
    
    // Begin transaction
    db.run('BEGIN TRANSACTION');
    
    let hasError = false;
    let successCount = 0;
    
    const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = parseCSVLine(line);
      
      if (values.length !== 3) {
        hasError = true;
        break;
      }
      
      const [name, description, priceStr] = values;
      const price = parseFloat(priceStr);
      
      if (!name || name.length === 0 || isNaN(price) || price < 0) {
        hasError = true;
        break;
      }
      
      stmt.run(merchantId, name, description || '', price, (err) => {
        if (err) {
          hasError = true;
        } else {
          successCount++;
        }
      });
    }
    
    stmt.finalize((err) => {
      if (hasError || err) {
        db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      
      db.run('COMMIT');
      res.status(200).json({ message: 'Wares uploaded successfully' });
    });
    
  } catch (error) {
    db.run('ROLLBACK');
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// Get wares
app.get('/wares', authenticate, (req, res) => {
  try {
    const { minPrice, maxPrice } = req.query;
    
    let query = `
      SELECT w.name, w.description, w.price, m.email
      FROM wares w
      JOIN merchants m ON w.merchant_id = m.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (minPrice !== undefined && minPrice !== '') {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        query += ' AND w.price >= ?';
        params.push(min);
      }
    }
    
    if (maxPrice !== undefined && maxPrice !== '') {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        query += ' AND w.price <= ?';
        params.push(max);
      }
    }
    
    query += ' ORDER BY w.price ASC';
    
    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve wares' });
      }
      
      // Generate HTML table with proper escaping
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wares</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Available Wares</h1>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Price</th>
        <th>Description</th>
        <th>Merchant Email</th>
      </tr>
    </thead>
    <tbody>`;
      
      if (rows.length === 0) {
        html += `
      <tr>
        <td colspan="4" style="text-align: center;">No wares found</td>
      </tr>`;
      } else {
        rows.forEach(row => {
          html += `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>$${escapeHtml(row.price.toFixed(2))}</td>
        <td>${escapeHtml(row.description || 'N/A')}</td>
        <td>${escapeHtml(row.email)}</td>
      </tr>`;
        });
      }
      
      html += `
    </tbody>
  </table>
</body>
</html>`;
      
      res.status(200).type('text/html').send(html);
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve wares' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Log error internally but don't expose details
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});