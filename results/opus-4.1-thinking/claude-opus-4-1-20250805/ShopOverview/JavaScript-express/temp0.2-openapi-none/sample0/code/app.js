const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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

// Middleware to verify JWT token from cookie
const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// Register merchant
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
app.post('/merchants/login', async (req, res) => {
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

      const validPassword = await bcrypt.compare(password, merchant.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: merchant.id, email: merchant.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.cookie('AUTH_COOKIE', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.status(200).json('Login successful');
    }
  );
});

// Simple CSV parser function
function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return null;
  
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  const nameIndex = headers.indexOf('name');
  const descriptionIndex = headers.indexOf('description');
  const priceIndex = headers.indexOf('price');
  
  if (nameIndex === -1 || descriptionIndex === -1 || priceIndex === -1) {
    return null;
  }
  
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = line.split(',').map(v => v.trim());
    if (values.length >= 3) {
      const name = values[nameIndex];
      const description = values[descriptionIndex];
      const price = parseFloat(values[priceIndex]);
      
      if (name && !isNaN(price)) {
        data.push({ name, description: description || '', price });
      }
    }
  }
  
  return data;
}

// Upload wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv } = req.body;
  
  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const merchantId = req.user.id;
  const wares = parseCSV(csv);
  
  if (!wares || wares.length === 0) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
  
  wares.forEach(ware => {
    stmt.run(merchantId, ware.name, ware.description, ware.price);
  });
  
  stmt.finalize((err) => {
    if (err) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    res.status(200).json({ message: 'Wares uploaded successfully' });
  });
});

// Get wares
app.get('/wares', authenticateToken, (req, res) => {
  const { minPrice, maxPrice } = req.query;
  
  let query = `
    SELECT w.name, w.description, w.price, m.email
    FROM wares w
    JOIN merchants m ON w.merchant_id = m.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (minPrice !== undefined && !isNaN(parseFloat(minPrice))) {
    query += ' AND w.price >= ?';
    params.push(parseFloat(minPrice));
  }
  
  if (maxPrice !== undefined && !isNaN(parseFloat(maxPrice))) {
    query += ' AND w.price <= ?';
    params.push(parseFloat(maxPrice));
  }
  
  query += ' ORDER BY w.price';

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
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f2f2f2;
          }
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

    rows.forEach(row => {
      html += `
        <tr>
          <td>${row.name}</td>
          <td>$${row.price.toFixed(2)}</td>
          <td>${row.description || ''}</td>
          <td>${row.email}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    res.status(200).type('html').send(html);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});