const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const csv = require('csv-parser');
const { Readable } = require('stream');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());
app.use(cookieParser());

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
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

// Helper function to generate UUID
function generateId() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4();
}

// Helper function to verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, APP_SECRET);
  } catch (err) {
    return null;
  }
}

// Middleware to check authentication
function authenticateToken(req, res, next) {
  const token = req.cookies.AUTH_COOKIE;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.merchantId = decoded.merchantId;
  req.merchantEmail = decoded.email;
  next();
}

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  // Validation
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const merchantId = generateId();

    db.run(
      'INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)',
      [merchantId, email, name, hashedPassword],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already registered' });
          }
          return res.status(400).json({ error: 'Registration failed' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, row) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    try {
      const passwordMatch = await bcrypt.compare(password, row.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { merchantId: row.id, email: row.email },
        APP_SECRET,
        { expiresIn: '24h' }
      );

      res.cookie('AUTH_COOKIE', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.status(200).json({ message: 'Login successful' });
    } catch (err) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv: csvString } = req.body;

  if (!csvString) {
    return res.status(400).json({ error: 'CSV data is required' });
  }

  const wares = [];
  const stream = Readable.from([csvString]);

  stream
    .pipe(csv())
    .on('data', (row) => {
      // Validate required fields
      if (!row.name || row.price === undefined) {
        throw new Error('Invalid CSV format: missing name or price');
      }

      const price = parseFloat(row.price);
      if (isNaN(price)) {
        throw new Error('Invalid CSV format: price must be a number');
      }

      wares.push({
        id: generateId(),
        merchant_id: req.merchantId,
        name: row.name.trim(),
        description: row.description ? row.description.trim() : '',
        price: price
      });
    })
    .on('end', () => {
      if (wares.length === 0) {
        return res.status(400).json({ error: 'No valid wares found in CSV' });
      }

      // Insert all wares
      const stmt = db.prepare(
        'INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)'
      );

      let insertedCount = 0;
      wares.forEach((ware) => {
        stmt.run(
          [ware.id, ware.merchant_id, ware.name, ware.description, ware.price],
          function (err) {
            if (err) {
              console.error('Error inserting ware:', err);
            } else {
              insertedCount++;
            }
          }
        );
      });

      stmt.finalize((err) => {
        if (err) {
          return res.status(400).json({ error: 'Failed to upload wares' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully', count: insertedCount });
      });
    })
    .on('error', (err) => {
      res.status(400).json({ error: 'Invalid CSV format' });
    });
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
  const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
  const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;

  let query = `
    SELECT w.name, w.price, w.description, m.email
    FROM wares w
    JOIN merchants m ON w.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (minPrice !== null && !isNaN(minPrice)) {
    query += ' AND w.price >= ?';
    params.push(minPrice);
  }

  if (maxPrice !== null && !isNaN(maxPrice)) {
    query += ' AND w.price <= ?';
    params.push(maxPrice);
  }

  query += ' ORDER BY w.name ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve wares' });
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
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #4CAF50; color: white; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          tr:hover { background-color: #ddd; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Available Wares</h1>
    `;

    if (rows.length === 0) {
      html += '<p>No wares found matching your criteria.</p>';
    } else {
      html += `
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

      rows.forEach((row) => {
        html += `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>$${row.price.toFixed(2)}</td>
            <td>${escapeHtml(row.description || '')}</td>
            <td>${escapeHtml(row.email)}</td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;
    }

    html += `
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

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});