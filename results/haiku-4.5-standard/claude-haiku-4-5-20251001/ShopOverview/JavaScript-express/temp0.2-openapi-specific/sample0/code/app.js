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
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database initialization
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Helper functions
const generateId = () => require('uuid').v4();

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

const generateToken = (merchantId) => {
  return jwt.sign({ merchantId }, APP_SECRET, { expiresIn: '24h' });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, APP_SECRET);
  } catch (err) {
    return null;
  }
};

const checkRateLimit = (email) => {
  return new Promise((resolve, reject) => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    db.get(
      `SELECT COUNT(*) as count FROM login_attempts WHERE email = ? AND timestamp > ?`,
      [email, fiveMinutesAgo.toISOString()],
      (err, row) => {
        if (err) reject(err);
        resolve(row.count >= 5);
      }
    );
  });
};

const recordLoginAttempt = (email) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO login_attempts (id, email) VALUES (?, ?)`,
      [generateId(), email],
      (err) => {
        if (err) reject(err);
        resolve();
      }
    );
  });
};

const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.merchantId = decoded.merchantId;
  next();
};

const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// Routes

// Register merchant
app.post('/merchants/register', express.json(), async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({ error: 'Invalid name' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await hashPassword(password);
    const merchantId = generateId();

    db.run(
      `INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)`,
      [merchantId, email, name, hashedPassword],
      (err) => {
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

// Login merchant
app.post('/merchants/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isRateLimited = await checkRateLimit(email);
    if (isRateLimited) {
      return res.status(401).json({ error: 'Too many login attempts. Try again later.' });
    }

    db.get(
      `SELECT id, password FROM merchants WHERE email = ?`,
      [email],
      async (err, row) => {
        if (err) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!row) {
          await recordLoginAttempt(email);
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const passwordMatch = await verifyPassword(password, row.password);
        if (!passwordMatch) {
          await recordLoginAttempt(email);
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = generateToken(row.id);
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          sameSite: 'Strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 24 * 60 * 60 * 1000
        });

        res.status(200).json({ message: 'Login successful' });
      }
    );
  } catch (err) {
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// Upload wares
app.post('/merchants/upload-wares', authenticateToken, express.json(), (req, res) => {
  try {
    const { csv: csvData } = req.body;

    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const wares = [];
    const readable = Readable.from([csvData]);

    readable
      .pipe(csv())
      .on('data', (row) => {
        if (!row.name || !row.price) {
          throw new Error('Missing required fields');
        }

        const price = parseFloat(row.price);
        if (isNaN(price) || price < 0) {
          throw new Error('Invalid price');
        }

        wares.push({
          id: generateId(),
          merchant_id: req.merchantId,
          name: row.name,
          description: row.description || '',
          price: price
        });
      })
      .on('end', () => {
        if (wares.length === 0) {
          return res.status(400).json({ error: 'No valid wares in CSV' });
        }

        const stmt = db.prepare(
          `INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)`
        );

        wares.forEach((ware) => {
          stmt.run([ware.id, ware.merchant_id, ware.name, ware.description, ware.price]);
        });

        stmt.finalize((err) => {
          if (err) {
            return res.status(400).json({ error: 'Failed to upload wares' });
          }
          res.status(200).json({ message: 'Wares uploaded successfully' });
        });
      })
      .on('error', (err) => {
        res.status(400).json({ error: 'Invalid CSV format' });
      });
  } catch (err) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// Get wares
app.get('/wares', authenticateToken, (req, res) => {
  try {
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;

    if ((minPrice !== null && isNaN(minPrice)) || (maxPrice !== null && isNaN(maxPrice))) {
      return res.status(400).json({ error: 'Invalid price filter' });
    }

    let query = `
      SELECT w.name, w.price, w.description, m.email
      FROM wares w
      JOIN merchants m ON w.merchant_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (minPrice !== null) {
      query += ` AND w.price >= ?`;
      params.push(minPrice);
    }

    if (maxPrice !== null) {
      query += ` AND w.price <= ?`;
      params.push(maxPrice);
    }

    query += ` ORDER BY w.name ASC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).send('<html><body><p>Error retrieving wares</p></body></html>');
      }

      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Warehouse</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #4CAF50; color: white; }
            tr:nth-child(even) { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>Warehouse</h1>
          <table>
            <tr>
              <th>Name</th>
              <th>Price</th>
              <th>Description</th>
              <th>Merchant Email</th>
            </tr>
      `;

      if (rows.length === 0) {
        html += `
            <tr>
              <td colspan="4">No wares found</td>
            </tr>
        `;
      } else {
        rows.forEach((row) => {
          html += `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>$${parseFloat(row.price).toFixed(2)}</td>
              <td>${escapeHtml(row.description)}</td>
              <td>${escapeHtml(row.email)}</td>
            </tr>
          `;
        });
      }

      html += `
          </table>
        </body>
        </html>
      `;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
    });
  } catch (err) {
    res.status(500).send('<html><body><p>Error retrieving wares</p></body></html>');
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});