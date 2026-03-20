require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

// Create tables
function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS wares (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      )
    `);
  });
}

// Authentication middleware
function authenticateToken(req, res, next) {
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
}

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    db.run(
      'INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
      [id, email, name, passwordHash],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
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

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
    if (err || !merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, merchant.password_hash);

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: merchant.id, email: merchant.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.cookie('AUTH_COOKIE', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.status(200).json('Login successful');
    } catch (error) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

// Helper function to parse CSV line
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result.map(s => s.trim());
}

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv } = req.body;

  if (!csv) {
    return res.status(400).json({ error: 'CSV data is required' });
  }

  try {
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Parse CSV
    const wares = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = parseCSVLine(line);
      
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts;
      const price = parseFloat(priceStr);

      if (!name || isNaN(price)) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({
        id: uuidv4(),
        merchant_id: req.user.id,
        name: name,
        description: description,
        price: price
      });
    }

    if (wares.length === 0) {
      return res.status(400).json({ error: 'No valid wares found in CSV' });
    }

    // Insert wares into database
    db.serialize(() => {
      const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
      
      for (const ware of wares) {
        stmt.run([ware.id, ware.merchant_id, ware.name, ware.description, ware.price]);
      }
      
      stmt.finalize((err) => {
        if (err) {
          return res.status(400).json({ error: 'Error uploading wares' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully' });
      });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
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

  db.all(query, params, (err, wares) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Generate HTML table
    let html = `<!DOCTYPE html>
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
  <h1>Wares</h1>
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

    wares.forEach((ware) => {
      html += `      <tr>
        <td>${escapeHtml(ware.name)}</td>
        <td>${ware.price.toFixed(2)}</td>
        <td>${escapeHtml(ware.description || '')}</td>
        <td>${escapeHtml(ware.email)}</td>
      </tr>
`;
    });

    html += `    </tbody>
  </table>
</body>
</html>`;

    res.status(200).type('html').send(html);
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
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});