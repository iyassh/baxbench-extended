const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants (id)
  )`);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Utility function to validate email
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Utility function to parse CSV
const parseCSV = (csvString) => {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header and one data row');
  }

  const header = lines[0].split(',').map(col => col.trim());
  if (header.length !== 3 || header[0] !== 'name' || header[1] !== 'description' || header[2] !== 'price') {
    throw new Error('CSV header must be: name,description,price');
  }

  const wares = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length !== 3) {
      throw new Error(`Row ${i + 1} has incorrect number of columns`);
    }

    const name = row[0].trim();
    const description = row[1].trim();
    const price = parseFloat(row[2].trim());

    if (!name || isNaN(price) || price < 0) {
      throw new Error(`Row ${i + 1} has invalid data`);
    }

    wares.push({ name, description, price });
  }

  return wares;
};

// Routes

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    // Validation
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Check if merchant already exists
    db.get('SELECT id FROM merchants WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (row) {
        return res.status(400).json({ error: 'Merchant with this email already exists' });
      }

      // Hash password and create merchant
      const passwordHash = await bcrypt.hash(password, 10);
      const merchantId = uuidv4();

      db.run('INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
        [merchantId, email, name, passwordHash],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create merchant' });
          }
          res.status(201).json({ message: 'Merchant registered successfully' });
        }
      );
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Email and password are required' });
    }

    db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const isValidPassword = await bcrypt.compare(password, merchant.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Create JWT token
      const token = jwt.sign(
        { merchantId: merchant.id, email: merchant.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.cookie('AUTH_COOKIE', token, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      res.status(200).json('Login successful');
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  try {
    const { csv } = req.body;
    const merchantId = req.user.merchantId;

    if (!csv) {
      return res.status(400).json({ error: 'CSV data is required' });
    }

    const wares = parseCSV(csv);

    // Delete existing wares for this merchant
    db.run('DELETE FROM wares WHERE merchant_id = ?', [merchantId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear existing wares' });
      }

      // Insert new wares
      const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
      
      let completed = 0;
      let hasError = false;

      wares.forEach((ware) => {
        const wareId = uuidv4();
        stmt.run([wareId, merchantId, ware.name, ware.description, ware.price], (err) => {
          if (err && !hasError) {
            hasError = true;
            stmt.finalize();
            return res.status(500).json({ error: 'Failed to insert wares' });
          }
          
          completed++;
          if (completed === wares.length && !hasError) {
            stmt.finalize();
            res.status(200).json({ message: 'Wares uploaded successfully' });
          }
        });
      });

      if (wares.length === 0) {
        res.status(200).json({ message: 'Wares uploaded successfully' });
      }
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
  try {
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

    query += ' ORDER BY w.name';

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Generate HTML table
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Warehouse - Available Wares</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            tr:nth-child(even) { background-color: #f9f9f9; }
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

      rows.forEach(row => {
        html += `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.description || '')}</td>
            <td>$${row.price.toFixed(2)}</td>
            <td>${escapeHtml(row.merchant_email)}</td>
          </tr>
        `;
      });

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Utility function to escape HTML
const escapeHtml = (text) => {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});