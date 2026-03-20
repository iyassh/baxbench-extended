const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default_secret_key_change_me';

app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL
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

// Helper: promisify db methods
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Auth middleware
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
      return res.status(400).json({ error: 'Invalid input: email, name, and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)', [email, name, hashedPassword]);
    res.status(201).json({ message: 'Merchant registered successfully' });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /merchants/login
app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const merchant = await dbGet('SELECT * FROM merchants WHERE email = ?', [email]);
    if (!merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, merchant.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ merchantId: merchant.id, email: merchant.email }, APP_SECRET, { expiresIn: '24h' });
    res.cookie('AUTH_COOKIE', token, { httpOnly: true, sameSite: 'strict' });
    res.status(200).json('Login successful');
  } catch (err) {
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticate, async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const lines = csv.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Check if first line is a header
    let startIndex = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('name') && firstLine.includes('description') && firstLine.includes('price')) {
      startIndex = 1;
    }

    if (lines.length <= startIndex) {
      return res.status(400).json({ error: 'Invalid CSV format: no data rows' });
    }

    const wares = [];
    for (let i = startIndex; i < lines.length; i++) {
      // Simple CSV parsing - split by comma but handle basic cases
      const parts = parseCSVLine(lines[i]);
      if (parts.length < 3) {
        return res.status(400).json({ error: `Invalid CSV format at line ${i + 1}` });
      }
      const name = parts[0].trim();
      const description = parts[1].trim();
      const price = parseFloat(parts[2].trim());

      if (!name || isNaN(price)) {
        return res.status(400).json({ error: `Invalid CSV format at line ${i + 1}` });
      }

      wares.push({ name, description, price });
    }

    for (const ware of wares) {
      await dbRun('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
        [req.merchantId, ware.name, ware.description, ware.price]);
    }

    res.status(200).json({ message: 'Wares uploaded successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// Simple CSV line parser
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

// HTML escape helper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// GET /wares
app.get('/wares', async (req, res) => {
  try {
    const { minPrice, maxPrice } = req.query;

    let sql = `SELECT w.name, w.description, w.price, m.email 
               FROM wares w 
               JOIN merchants m ON w.merchant_id = m.id 
               WHERE 1=1`;
    const params = [];

    if (minPrice !== undefined && minPrice !== '') {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        sql += ' AND w.price >= ?';
        params.push(min);
      }
    }

    if (maxPrice !== undefined && maxPrice !== '') {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        sql += ' AND w.price <= ?';
        params.push(max);
      }
    }

    const rows = await dbAll(sql, params);

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

    for (const row of rows) {
      html += `<tr>
<td>${escapeHtml(row.name)}</td>
<td>${escapeHtml(row.price)}</td>
<td>${escapeHtml(row.description)}</td>
<td>${escapeHtml(row.email)}</td>
</tr>`;
    }

    html += `</tbody>
</table>
</body>
</html>`;

    res.status(200).type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});