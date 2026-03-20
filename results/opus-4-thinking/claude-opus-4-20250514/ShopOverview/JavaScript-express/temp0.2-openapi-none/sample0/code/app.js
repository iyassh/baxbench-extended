const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { Readable } = require('stream');
const csv = require('csv-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS wares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants (id)
    )
  `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  jwt.verify(token, APP_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.merchantId = decoded.merchantId;
    next();
  });
};

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
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Email already exists' });
          }
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;
  
  db.get(
    'SELECT id, email, password FROM merchants WHERE email = ?',
    [email],
    async (err, merchant) => {
      if (err || !merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      const validPassword = await bcrypt.compare(password, merchant.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      const token = jwt.sign(
        { merchantId: merchant.id, email: merchant.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );
      
      res.cookie('AUTH_COOKIE', token, {
        httpOnly: true,
        sameSite: 'strict'
      });
      
      res.status(200).json('Login successful');
    }
  );
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv: csvData } = req.body;
  
  if (!csvData) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }
  
  const results = [];
  const stream = Readable.from(csvData);
  
  stream
    .pipe(csv({ headers: false }))
    .on('data', (row) => {
      // CSV columns: name, description, price
      if (row[0] && row[2] !== undefined) {
        results.push({
          name: row[0],
          description: row[1] || '',
          price: parseFloat(row[2])
        });
      }
    })
    .on('end', () => {
      if (results.length === 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      
      // Validate all rows before inserting
      for (const row of results) {
        if (!row.name || isNaN(row.price)) {
          return res.status(400).json({ error: 'Invalid CSV format' });
        }
      }
      
      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      
      results.forEach((row) => {
        stmt.run(req.merchantId, row.name, row.description, row.price);
      });
      
      stmt.finalize(() => {
        res.status(200).json({ message: 'Wares uploaded successfully' });
      });
    })
    .on('error', () => {
      res.status(400).json({ error: 'Invalid CSV format' });
    });
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
  const { minPrice, maxPrice } = req.query;
  
  let query = `
    SELECT w.name, w.description, w.price, m.email
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
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
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
          <tr>
            <th>Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
          </tr>
    `;
    
    rows.forEach(row => {
      html += `
        <tr>
          <td>${row.name}</td>
          <td>$${row.price.toFixed(2)}</td>
          <td>${row.description}</td>
          <td>${row.email}</td>
        </tr>
      `;
    });
    
    html += `
        </table>
      </body>
      </html>
    `;
    
    res.status(200).type('text/html').send(html);
  });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});