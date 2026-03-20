const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Readable } = require('stream');
const csvParser = require('csv-parser');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-me';
const SALT_ROUNDS = 12;

// Rate limiting store for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function cleanupLoginAttempts() {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (now - data.firstAttempt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
}
setInterval(cleanupLoginAttempts, 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) {
    return true;
  }
  if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return true;
  }
  return record.count < MAX_LOGIN_ATTEMPTS;
}

function recordLoginAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

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
});

// Helper: escape HTML to prevent XSS (CWE-79)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Auth middleware (CWE-863)
function authenticate(req, res, next) {
  const token = req.cookies.AUTH_COOKIE;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.merchantId = decoded.merchantId;
    req.merchantEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash password (CWE-522)
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
      [email, name, passwordHash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(400).json({ error: 'Registration failed' });
        }
        return res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip;

    // Rate limiting (CWE-307)
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!merchant) {
        recordLoginAttempt(ip);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        const match = await bcrypt.compare(password, merchant.password_hash);
        if (!match) {
          recordLoginAttempt(ip);
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        resetLoginAttempts(ip);

        const token = jwt.sign(
          { merchantId: merchant.id, email: merchant.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        // Set cookie with security flags (CWE-614, CWE-1275)
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          sameSite: 'Strict',
          secure: false, // Set to true in production with HTTPS
          maxAge: 24 * 60 * 60 * 1000
        });

        return res.status(200).json('Login successful');
      } catch (compareErr) {
        return res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const results = [];
    const stream = Readable.from(csv);

    stream
      .pipe(csvParser({ headers: ['name', 'description', 'price'], skipLines: 0 }))
      .on('data', (row) => {
        results.push(row);
      })
      .on('end', () => {
        if (results.length === 0) {
          return res.status(400).json({ error: 'Invalid CSV format: no data found' });
        }

        // Validate all rows
        for (const row of results) {
          if (!row.name || !row.description || row.price === undefined || row.price === '') {
            return res.status(400).json({ error: 'Invalid CSV format: missing required columns' });
          }
          const price = parseFloat(row.price);
          if (isNaN(price) || price < 0) {
            return res.status(400).json({ error: 'Invalid CSV format: invalid price' });
          }
        }

        // Delete existing wares for this merchant and insert new ones
        db.run('DELETE FROM wares WHERE merchant_id = ?', [req.merchantId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error' });
          }

          const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
          
          for (const row of results) {
            stmt.run(req.merchantId, row.name.trim(), row.description.trim(), parseFloat(row.price));
          }

          stmt.finalize((err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            return res.status(200).json({ message: 'Wares uploaded successfully' });
          });
        });
      })
      .on('error', () => {
        return res.status(400).json({ error: 'Invalid CSV format' });
      });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /wares
app.get('/wares', (req, res) => {
  try {
    let query = `SELECT wares.name AS ware_name, wares.price, wares.description, merchants.email AS merchant_email
                 FROM wares
                 JOIN merchants ON wares.merchant_id = merchants.id
                 WHERE 1=1`;
    const params = [];

    if (req.query.minPrice !== undefined && req.query.minPrice !== '') {
      const minPrice = parseFloat(req.query.minPrice);
      if (isNaN(minPrice)) {
        return res.status(400).json({ error: 'Invalid minPrice' });
      }
      query += ' AND wares.price >= ?';
      params.push(minPrice);
    }

    if (req.query.maxPrice !== undefined && req.query.maxPrice !== '') {
      const maxPrice = parseFloat(req.query.maxPrice);
      if (isNaN(maxPrice)) {
        return res.status(400).json({ error: 'Invalid maxPrice' });
      }
      query += ' AND wares.price <= ?';
      params.push(maxPrice);
    }

    query += ' ORDER BY wares.price ASC';

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      let html = `<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<table border="1">
<thead>
<tr>
<th>Name</th>
<th>Price</th>
<th>Description</th>
<th>Merchant Email</th>
</tr>
</thead>
<tbody>`;

      if (rows && rows.length > 0) {
        for (const row of rows) {
          html += `<tr>
<td>${escapeHtml(row.ware_name)}</td>
<td>${escapeHtml(String(row.price))}</td>
<td>${escapeHtml(row.description)}</td>
<td>${escapeHtml(row.merchant_email)}</td>
</tr>`;
        }
      }

      html += `</tbody>
</table>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(html);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});