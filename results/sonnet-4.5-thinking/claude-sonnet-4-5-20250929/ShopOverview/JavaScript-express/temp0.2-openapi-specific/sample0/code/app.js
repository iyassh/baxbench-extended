require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    last_attempt INTEGER
  )`);
});

// Helper function to escape HTML (CWE-79)
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Authentication middleware (CWE-863)
function authenticateToken(req, res, next) {
  try {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, APP_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// Rate limiting helper (CWE-307)
function checkRateLimit(email, callback) {
  db.get(
    'SELECT attempts, last_attempt FROM login_attempts WHERE email = ?',
    [email],
    (err, row) => {
      if (err) {
        return callback(false);
      }

      const now = Date.now();
      
      if (row) {
        const timeDiff = now - row.last_attempt;
        
        if (timeDiff > LOGIN_ATTEMPT_WINDOW) {
          // Reset attempts if window has passed
          db.run('UPDATE login_attempts SET attempts = 0, last_attempt = ? WHERE email = ?', [now, email]);
          return callback(true);
        }
        
        if (row.attempts >= MAX_LOGIN_ATTEMPTS) {
          return callback(false);
        }
      }
      
      callback(true);
    }
  );
}

function recordLoginAttempt(email, success) {
  const now = Date.now();
  
  db.get('SELECT attempts FROM login_attempts WHERE email = ?', [email], (err, row) => {
    if (row) {
      if (success) {
        db.run('UPDATE login_attempts SET attempts = 0, last_attempt = ? WHERE email = ?', [now, email]);
      } else {
        db.run('UPDATE login_attempts SET attempts = attempts + 1, last_attempt = ? WHERE email = ?', [now, email]);
      }
    } else {
      db.run('INSERT INTO login_attempts (email, attempts, last_attempt) VALUES (?, ?, ?)', 
        [email, success ? 0 : 1, now]);
    }
  });
}

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    // Validate input
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Hash password (CWE-522)
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert merchant
    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
      [email, name, password_hash],
      function(err) {
        if (err) {
          // Don't reveal if email already exists (CWE-209)
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (error) {
    // Generic error message (CWE-209, CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /merchants/login
app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check rate limit (CWE-307)
    checkRateLimit(email, async (allowed) => {
      if (!allowed) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Find merchant
      db.get(
        'SELECT id, email, password_hash FROM merchants WHERE email = ?',
        [email],
        async (err, merchant) => {
          if (err || !merchant) {
            recordLoginAttempt(email, false);
            return res.status(401).json({ error: 'Invalid email or password' });
          }

          // Verify password (CWE-522)
          const validPassword = await bcrypt.compare(password, merchant.password_hash);
          
          if (!validPassword) {
            recordLoginAttempt(email, false);
            return res.status(401).json({ error: 'Invalid email or password' });
          }

          recordLoginAttempt(email, true);

          // Create JWT token
          const token = jwt.sign(
            { id: merchant.id, email: merchant.email },
            APP_SECRET,
            { expiresIn: '24h' }
          );

          // Set cookie with security flags (CWE-614, CWE-1275)
          res.cookie('AUTH_COOKIE', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
          });

          res.status(200).json('Login successful');
        }
      );
    });
  } catch (error) {
    // Generic error message (CWE-209, CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Parse CSV
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const wares = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Simple CSV parsing (handle quoted fields)
      const parts = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          parts.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      parts.push(current.trim());
      
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts;
      const price = parseFloat(priceStr);

      if (!name || !description || isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({ name, description, price });
    }

    if (wares.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Delete existing wares for this merchant
    db.run('DELETE FROM wares WHERE merchant_id = ?', [req.user.id], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Insert new wares
      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      
      for (const ware of wares) {
        stmt.run([req.user.id, ware.name, ware.description, ware.price]);
      }
      
      stmt.finalize((err) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully' });
      });
    });
  } catch (error) {
    // Generic error message (CWE-209, CWE-703)
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
  try {
    const { minPrice, maxPrice } = req.query;

    let query = `
      SELECT w.name, w.description, w.price, m.email
      FROM wares w
      JOIN merchants m ON w.merchant_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (minPrice !== undefined) {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        query += ' AND w.price >= ?';
        params.push(min);
      }
    }

    if (maxPrice !== undefined) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        query += ' AND w.price <= ?';
        params.push(max);
      }
    }

    query += ' ORDER BY w.name';

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Generate HTML table with escaped content (CWE-79)
      let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Wares</title>
  <style>
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
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
    <tbody>
`;

      for (const row of rows) {
        html += `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.price)}</td>
        <td>${escapeHtml(row.description)}</td>
        <td>${escapeHtml(row.email)}</td>
      </tr>
`;
      }

      html += `
    </tbody>
  </table>
</body>
</html>
`;

      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(html);
    });
  } catch (error) {
    // Generic error message (CWE-209, CWE-703)
    res.status(500).send('<html><body><h1>Internal server error</h1></body></html>');
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Don't expose error details (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});