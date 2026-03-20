require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { parse } = require('csv-parse/sync');

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default_secret_change_me';
const SALT_ROUNDS = 10;

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

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
    description TEXT,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

// Middleware to authenticate via cookie
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

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Invalid input: email, name, and password are required' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ error: 'Invalid password' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase().trim(), name.trim(), passwordHash],
      function (err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(500).json({ error: 'Internal server error' });
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
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get(
    'SELECT * FROM merchants WHERE email = ?',
    [email.toLowerCase().trim()],
    async (err, merchant) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        const match = await bcrypt.compare(password, merchant.password_hash);
        if (!match) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { id: merchant.id, email: merchant.email, name: merchant.name },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000
        });

        return res.status(200).json('Login successful');
      } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
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
    return res.status(400).json({ error: 'Invalid CSV format: ' + err.message });
  }

  if (!records || records.length === 0) {
    return res.status(400).json({ error: 'CSV is empty or invalid' });
  }

  // Validate columns
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
    db.run('DELETE FROM wares WHERE merchant_id = ?', [merchantId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      let insertError = null;

      for (const record of records) {
        const price = parseFloat(record.price);
        const name = record.name ? record.name.trim() : '';
        const description = record.description ? record.description.trim() : '';
        stmt.run([merchantId, name, description, price], (err) => {
          if (err) insertError = err;
        });
      }

      stmt.finalize((err) => {
        if (err || insertError) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        return res.status(200).json({ message: 'Wares uploaded successfully' });
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

  query += ' ORDER BY w.price ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    const escapeHtml = (str) => {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    };

    let tableRows = '';
    for (const row of rows) {
      tableRows += `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td>${escapeHtml(row.price)}</td>
          <td>${escapeHtml(row.merchant_email)}</td>
        </tr>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Warehouse - Available Wares</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    tr:hover { background-color: #ddd; }
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
      ${tableRows || '<tr><td colspan="4">No wares found</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});

module.exports = app;