const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const { Readable } = require('stream');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Database setup
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
    // Create merchants table
    db.run(`
      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create wares table
    db.run(`
      CREATE TABLE IF NOT EXISTS wares (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);
  });
}

// Helper function to verify JWT token
function verifyToken(req, res, next) {
  const token = req.cookies.AUTH_COOKIE;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.merchantId = decoded.id;
    req.merchantEmail = decoded.email;
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
    const merchantId = uuidv4();

    db.run(
      'INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)',
      [merchantId, email, name, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    try {
      const passwordMatch = await bcrypt.compare(password, merchant.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ id: merchant.id, email: merchant.email }, APP_SECRET, {
        expiresIn: '24h',
      });

      res.cookie('AUTH_COOKIE', token, { httpOnly: true, maxAge: 86400000 });
      res.status(200).json('Login successful');
    } catch (err) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', verifyToken, (req, res) => {
  const { csv: csvString } = req.body;

  if (!csvString) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const wares = [];
  const readable = Readable.from([csvString]);

  readable
    .pipe(csv())
    .on('data', (row) => {
      if (row.name && row.price) {
        wares.push({
          id: uuidv4(),
          merchant_id: req.merchantId,
          name: row.name,
          description: row.description || '',
          price: parseFloat(row.price),
        });
      }
    })
    .on('end', () => {
      if (wares.length === 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      db.serialize(() => {
        const stmt = db.prepare(
          'INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)'
        );

        wares.forEach((ware) => {
          stmt.run([ware.id, ware.merchant_id, ware.name, ware.description, ware.price]);
        });

        stmt.finalize((err) => {
          if (err) {
            return res.status(400).json({ error: 'Invalid CSV format' });
          }
          res.status(200).json({ message: 'Wares uploaded successfully' });
        });
      });
    })
    .on('error', () => {
      res.status(400).json({ error: 'Invalid CSV format' });
    });
});

// GET /wares
app.get('/wares', verifyToken, (req, res) => {
  const { minPrice, maxPrice } = req.query;

  let query = `
    SELECT w.name, w.price, w.description, m.email
    FROM wares w
    JOIN merchants m ON w.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (minPrice !== undefined) {
    query += ' AND w.price >= ?';
    params.push(parseFloat(minPrice));
  }

  if (maxPrice !== undefined) {
    query += ' AND w.price <= ?';
    params.push(parseFloat(maxPrice));
  }

  query += ' ORDER BY w.name ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Warehouse - Available Wares</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
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
              <th>Price</th>
              <th>Description</th>
              <th>Merchant Email</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (rows.length === 0) {
      html += '<tr><td colspan="4">No wares found</td></tr>';
    } else {
      rows.forEach((row) => {
        html += `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>$${row.price.toFixed(2)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.email)}</td>
          </tr>
        `;
      });
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
});

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});