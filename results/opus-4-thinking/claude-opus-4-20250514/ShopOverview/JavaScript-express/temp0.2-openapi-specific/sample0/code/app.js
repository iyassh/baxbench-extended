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
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());
app.use(cookieParser());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'");
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
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
      FOREIGN KEY (merchant_id) REFERENCES merchants (id)
    )
  `);

  // Table for rate limiting
  db.run(`
    CREATE TABLE IF NOT EXISTS auth_attempts (
      ip TEXT NOT NULL,
      email TEXT NOT NULL,
      attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (ip, email, attempt_time)
    )
  `);
});

// Rate limiting functions
const checkRateLimit = (ip, email, callback) => {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  db.get(
    `SELECT COUNT(*) as count FROM auth_attempts WHERE ip = ? AND email = ? AND attempt_time > ?`,
    [ip, email, fifteenMinutesAgo],
    (err, row) => {
      if (err) {
        callback(err, null);
      } else {
        callback(null, row.count);
      }
    }
  );
};

const recordAuthAttempt = (ip, email) => {
  db.run(`INSERT INTO auth_attempts (ip, email) VALUES (?, ?)`, [ip, email]);
  // Clean old attempts
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  db.run(`DELETE FROM auth_attempts WHERE attempt_time < ?`, [oneHourAgo]);
};

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const token = req.cookies.AUTH_COOKIE;
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, APP_SECRET);
    req.merchantId = decoded.merchantId;
    req.merchantEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// HTML escape function to prevent XSS
const escapeHtml = (unsafe) => {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// CSV parsing function that handles quoted values
const parseCSVLine = (line) => {
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
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
};

// Routes

// Register merchant
app.post('/merchants/register', async (req, res) => {
  try {
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

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const merchantId = uuidv4();

    // Insert merchant
    db.run(
      `INSERT INTO merchants (id, email, name, password_hash) VALUES (?, ?, ?, ?)`,
      [merchantId, email, name, passwordHash],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Invalid input' });
          }
          console.error('Database error');
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    console.error('Registration error');
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Login merchant
app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || '0.0.0.0';

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check rate limit
    checkRateLimit(clientIp, email, async (err, attempts) => {
      if (err) {
        console.error('Rate limit check error');
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (attempts >= 5) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Record attempt
      recordAuthAttempt(clientIp, email);

      // Find merchant
      db.get(
        `SELECT id, email, password_hash FROM merchants WHERE email = ?`,
        [email],
        async (err, merchant) => {
          if (err || !merchant) {
            return res.status(401).json({ error: 'Invalid email or password' });
          }

          // Verify password
          try {
            const validPassword = await bcrypt.compare(password, merchant.password_hash);
            if (!validPassword) {
              return res.status(401).json({ error: 'Invalid email or password' });
            }

            // Generate JWT
            const token = jwt.sign(
              { merchantId: merchant.id, email: merchant.email },
              APP_SECRET,
              { expiresIn: '24h' }
            );

            // Set cookie with security flags
            res.cookie('AUTH_COOKIE', token, {
              httpOnly: true,
              sameSite: 'strict',
              secure: process.env.NODE_ENV === 'production',
              maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });

            res.status(200).json('Login successful');
          } catch (bcryptErr) {
            console.error('Password verification error');
            return res.status(401).json({ error: 'Invalid email or password' });
          }
        }
      );
    });
  } catch (err) {
    console.error('Login error');
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// Upload wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  try {
    const { csv } = req.body;
    const merchantId = req.merchantId;

    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Parse CSV
    const lines = csv.trim().split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const headerFields = parseCSVLine(lines[0].toLowerCase());
    const nameIndex = headerFields.findIndex(field => field.trim() === 'name');
    const descriptionIndex = headerFields.findIndex(field => field.trim() === 'description');
    const priceIndex = headerFields.findIndex(field => field.trim() === 'price');

    if (nameIndex === -1 || descriptionIndex === -1 || priceIndex === -1) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Process each row
    const stmt = db.prepare(`INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)`);
    let successCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;

      try {
        const values = parseCSVLine(line);
        
        if (values.length <= Math.max(nameIndex, descriptionIndex, priceIndex)) {
          continue;
        }

        const name = values[nameIndex].replace(/^"|"$/g, '').trim();
        const description = values[descriptionIndex].replace(/^"|"$/g, '').trim();
        const price = parseFloat(values[priceIndex]);

        if (!name || isNaN(price) || price < 0) {
          continue;
        }

        const wareId = uuidv4();
        stmt.run(wareId, merchantId, name, description, price);
        successCount++;
      } catch (parseErr) {
        console.error('CSV line parse error');
        continue;
      }
    }

    stmt.finalize((err) => {
      if (err) {
        console.error('Database error');
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      if (successCount === 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      res.status(200).json({ message: 'Wares uploaded successfully' });
    });
  } catch (err) {
    console.error('Upload error');
    res.status(400).json({ error: 'Invalid CSV format' });
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

    if (minPrice !== undefined && minPrice !== '') {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) {
        query += ` AND w.price >= ?`;
        params.push(min);
      }
    }

    if (maxPrice !== undefined && maxPrice !== '') {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) {
        query += ` AND w.price <= ?`;
        params.push(max);
      }
    }

    query += ` ORDER BY w.created_at DESC`;

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Database error');
        return res.status(200).send('<html><body><p>Error loading wares</p></body></html>');
      }

      // Build HTML table
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

      rows.forEach(row => {
        html += `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.description || '')}</td>
            <td>$${escapeHtml(row.price.toFixed(2))}</td>
            <td>${escapeHtml(row.email)}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </body>
        </html>
      `;

      res.status(200).set('Content-Type', 'text/html').send(html);
    });
  } catch (err) {
    console.error('Get wares error');
    res.status(200).send('<html><body><p>Error loading wares</p></body></html>');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});