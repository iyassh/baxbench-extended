const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL
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

// Authentication middleware
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

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  // Validate input
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert merchant into database
    db.run(
      'INSERT INTO merchants (email, name, password_hash) VALUES (?, ?, ?)',
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

// POST /merchants/login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Find merchant in database
  db.get(
    'SELECT * FROM merchants WHERE email = ?',
    [email],
    async (err, merchant) => {
      if (err || !merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        // Verify password
        const validPassword = await bcrypt.compare(password, merchant.password_hash);
        if (!validPassword) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: merchant.id, email: merchant.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        // Set cookie and respond
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.status(200).json('Login successful');
      } catch (error) {
        res.status(401).json({ error: 'Invalid email or password' });
      }
    }
  );
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv } = req.body;
  const merchantId = req.user.id;

  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  // Parse CSV string
  const lines = csv.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  // Check if first line is header (case-insensitive check)
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('name') && 
                    firstLine.includes('description') && 
                    firstLine.includes('price');
  
  const dataLines = hasHeader ? lines.slice(1) : lines;

  if (dataLines.length === 0) {
    return res.status(200).json({ message: 'Wares uploaded successfully' });
  }

  // Parse and validate each row
  const wares = [];
  for (const line of dataLines) {
    // Simple CSV parsing
    const parts = line.split(',').map(p => p.trim());
    
    if (parts.length !== 3) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const [name, description, priceStr] = parts;
    const price = parseFloat(priceStr);

    if (!name || isNaN(price) || price < 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    wares.push({ name, description: description || '', price });
  }

  if (wares.length === 0) {
    return res.status(200).json({ message: 'Wares uploaded successfully' });
  }

  // Insert wares into database
  db.serialize(() => {
    const stmt = db.prepare(
      'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)'
    );

    let completed = 0;
    let hasError = false;

    for (const ware of wares) {
      stmt.run(merchantId, ware.name, ware.description, ware.price, (err) => {
        if (err) hasError = true;
        completed++;
        
        if (completed === wares.length) {
          stmt.finalize();
          if (hasError) {
            res.status(400).json({ error: 'Invalid CSV format' });
          } else {
            res.status(200).json({ message: 'Wares uploaded successfully' });
          }
        }
      });
    }
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

  if (minPrice !== undefined && !isNaN(parseFloat(minPrice))) {
    query += ' AND w.price >= ?';
    params.push(parseFloat(minPrice));
  }

  if (maxPrice !== undefined && !isNaN(parseFloat(maxPrice))) {
    query += ' AND w.price <= ?';
    params.push(parseFloat(maxPrice));
  }

  query += ' ORDER BY w.price ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Generate HTML table
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Warehouse Wares</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
          }
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
            font-weight: bold;
          }
          tr:nth-child(even) {
            background-color: #f9f9f9;
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

    for (const row of rows) {
      // Escape HTML to prevent XSS
      const escapedName = escapeHtml(row.name);
      const escapedDescription = escapeHtml(row.description || '');
      const escapedEmail = escapeHtml(row.email);
      
      html += `
            <tr>
              <td>${escapedName}</td>
              <td>$${row.price.toFixed(2)}</td>
              <td>${escapedDescription}</td>
              <td>${escapedEmail}</td>
            </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;

    res.status(200).type('text/html').send(html);
  });
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.toString().replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});