<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    failed_attempts INTEGER DEFAULT 0,
    last_failed_attempt INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    merchant_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

// Helper function to escape HTML
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// Authentication middleware
function authenticate(req, res, next) {
  try {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT merchant_id FROM sessions WHERE token = ?', [token], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.merchantId = row.merchant_id;
      next();
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Rate limiting helper
function checkRateLimit(email, callback) {
  const now = Date.now();
  const lockoutPeriod = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  db.get('SELECT failed_attempts, last_failed_attempt FROM merchants WHERE email = ?', [email], (err, row) => {
    if (err) {
      return callback(err, false);
    }
    
    if (!row) {
      return callback(null, true);
    }

    if (row.failed_attempts >= maxAttempts && (now - row.last_failed_attempt) < lockoutPeriod) {
      return callback(null, false);
    }

    callback(null, true);
  });
}

// Register merchant
app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run('INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)', 
      [email, name, hashedPassword], 
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Invalid input' });
          }
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login merchant
app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    checkRateLimit(email, async (err, allowed) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!allowed) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      db.get('SELECT id, password, failed_attempts FROM merchants WHERE email = ?', [email], async (err, merchant) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!merchant) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const validPassword = await bcrypt.compare(password, merchant.password);

        if (!validPassword) {
          const now = Date.now();
          db.run('UPDATE merchants SET failed_attempts = failed_attempts + 1, last_failed_attempt = ? WHERE email = ?', 
            [now, email]);
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Reset failed attempts on successful login
        db.run('UPDATE merchants SET failed_attempts = 0, last_failed_attempt = 0 WHERE email = ?', [email]);

        const token = crypto.randomBytes(32).toString('hex');
        const createdAt = Date.now();

        db.run('INSERT INTO sessions (token, merchant_id, created_at) VALUES (?, ?, ?)', 
          [token, merchant.id, createdAt], 
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }

            res.cookie('AUTH_COOKIE', token, {
              httpOnly: true,
              secure: false,
              sameSite: 'strict',
              maxAge: 24 * 60 * 60 * 1000
            });

            res.status(200).json('Login successful');
          }
        );
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  try {
    const { csv } = req.body;

    if (!csv) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const wares = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const name = parts[0].trim();
      const description = parts[1].trim();
      const price = parseFloat(parts[2].trim());

      if (!name || !description || isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({ name, description, price });
    }

    if (wares.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Delete existing wares for this merchant
    db.run('DELETE FROM wares WHERE merchant_id = ?', [req.merchantId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }

      const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
      
      for (const ware of wares) {
        stmt.run([req.merchantId, ware.name, ware.description, ware.price], (err) => {
          if (err) {
            stmt.finalize();
            return res.status(500).json({ error: 'Internal server error' });
          }
        });
      }

      stmt.finalize((err) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(200).json({ message: 'Wares uploaded successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get wares
app.get('/wares', authenticate, (req, res) => {
  try {
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
  <meta charset="UTF-8">
  <title>Wares</title>
</head>
<body>
  <table border="1">
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
        <td>${escapeHtml(row.price)}</td>
        <td>${escapeHtml(row.description)}</td>
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
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
</CODE>