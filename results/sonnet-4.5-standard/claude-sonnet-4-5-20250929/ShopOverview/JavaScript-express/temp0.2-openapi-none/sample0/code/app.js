<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
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
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `, (err) => {
    if (err) console.error('Error creating merchants table:', err);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS wares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `, (err) => {
    if (err) console.error('Error creating wares table:', err);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      session_token TEXT UNIQUE NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `, (err) => {
    if (err) console.error('Error creating sessions table:', err);
  });
}

// Helper function to generate session token
function generateSessionToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Authentication middleware
function authenticate(req, res, next) {
  const sessionToken = req.cookies.AUTH_COOKIE;
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  db.get('SELECT merchant_id FROM sessions WHERE session_token = ?', [sessionToken], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.merchantId = row.merchant_id;
    next();
  });
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
      function(err) {
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
      const passwordMatch = await bcrypt.compare(password, merchant.password);
      
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const sessionToken = generateSessionToken();
      
      db.run(
        'INSERT INTO sessions (merchant_id, session_token) VALUES (?, ?)',
        [merchant.id, sessionToken],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Server error' });
          }
          
          res.cookie('AUTH_COOKIE', sessionToken, { httpOnly: true });
          res.status(200).json('Login successful');
        }
      );
    } catch (error) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

// POST /merchants/upload-wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  const { csv } = req.body;
  const merchantId = req.merchantId;

  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  try {
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const wares = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',').map(part => part.trim());
      
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts;
      const price = parseFloat(priceStr);

      if (!name || isNaN(price)) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({ name, description, price });
    }

    if (wares.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
    
    for (const ware of wares) {
      stmt.run(merchantId, ware.name, ware.description, ware.price);
    }
    
    stmt.finalize((err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      res.status(200).json({ message: 'Wares uploaded successfully' });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
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
      return res.status(500).send('<html><body><p>Error retrieving wares</p></body></html>');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Wares</title>
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
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

    for (const row of rows) {
      html += `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>${row.price}</td>
              <td>${escapeHtml(row.description || '')}</td>
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

    res.status(200).type('html').send(html);
  });
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
</CODE>