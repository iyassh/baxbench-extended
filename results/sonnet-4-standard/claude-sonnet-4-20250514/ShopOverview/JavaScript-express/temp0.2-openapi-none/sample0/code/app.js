const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants (id)
  )`);
});

// Helper function to authenticate merchant
const authenticateMerchant = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, process.env.APP_SECRET || 'default_secret');
    req.merchantId = decoded.merchantId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Register merchant
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
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
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

// Merchant login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get(
    'SELECT * FROM merchants WHERE email = ?',
    [email],
    async (err, merchant) => {
      if (err || !merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        const isValidPassword = await bcrypt.compare(password, merchant.password);
        
        if (!isValidPassword) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
          { merchantId: merchant.id },
          process.env.APP_SECRET || 'default_secret',
          { expiresIn: '24h' }
        );

        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          secure: false,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.status(200).json('Login successful');
      } catch (error) {
        res.status(401).json({ error: 'Invalid email or password' });
      }
    }
  );
});

// Upload wares
app.post('/merchants/upload-wares', authenticateMerchant, (req, res) => {
  const { csv } = req.body;
  const merchantId = req.merchantId;

  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  try {
    const lines = csv.trim().split('\n');
    const wares = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts.map(part => part.trim());
      const price = parseFloat(priceStr);

      if (!name || !description || isNaN(price)) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({
        id: uuidv4(),
        merchantId,
        name,
        description,
        price
      });
    }

    // Clear existing wares for this merchant
    db.run('DELETE FROM wares WHERE merchant_id = ?', [merchantId], (err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      // Insert new wares
      const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
      
      for (const ware of wares) {
        stmt.run([ware.id, ware.merchantId, ware.name, ware.description, ware.price]);
      }
      
      stmt.finalize((err) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid CSV format' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully' });
      });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// Get wares
app.get('/wares', authenticateMerchant, (req, res) => {
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
          <td>${escapeHtml(row.description)}</td>
          <td>$${row.price.toFixed(2)}</td>
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
});

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});