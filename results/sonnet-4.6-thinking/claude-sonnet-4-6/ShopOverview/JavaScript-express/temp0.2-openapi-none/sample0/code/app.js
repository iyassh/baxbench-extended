const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default_secret';

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
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
}

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
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
      [email, name, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(400).json({ error: 'Invalid input' });
        }
        return res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /merchants/login
app.post('/merchants/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
    if (err || !merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, merchant.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: merchant.id, email: merchant.email }, APP_SECRET, { expiresIn: '24h' });
    res.cookie('AUTH_COOKIE', token, { httpOnly: true });
    return res.status(200).json('Login successful');
  });
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  const { csv } = req.body;
  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const results = [];
  const errors = [];

  const stream = Readable.from([csv]);
  stream
    .pipe(csvParser({ headers: ['name', 'description', 'price'], skipLines: 0 }))
    .on('data', (row) => {
      const price = parseFloat(row.price);
      if (!row.name || isNaN(price)) {
        errors.push('Invalid row');
      } else {
        results.push({ name: row.name, description: row.description || '', price });
      }
    })
    .on('end', () => {
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      if (results.length === 0) {
        return res.status(400).json({ error: 'No valid wares found in CSV' });
      }

      const merchantId = req.merchant.id;
      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        for (const ware of results) {
          stmt.run([merchantId, ware.name, ware.description, ware.price]);
        }
        db.run('COMMIT', (err) => {
          if (err) {
            return res.status(400).json({ error: 'Failed to upload wares' });
          }
          return res.status(200).json({ message: 'Wares uploaded successfully' });
        });
        stmt.finalize();
      });
    })
    .on('error', () => {
      return res.status(400).json({ error: 'Invalid CSV format' });
    });
});

// GET /wares
app.get('/wares', authenticate, (req, res) => {
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

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
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
    `;

    for (const row of rows) {
      html += `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.description || '')}</td>
          <td>${row.price.toFixed(2)}</td>
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
    return res.status(200).send(html);
  });
});

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});