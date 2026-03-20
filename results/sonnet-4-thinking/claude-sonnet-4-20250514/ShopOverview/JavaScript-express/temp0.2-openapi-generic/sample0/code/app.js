require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const DB_PATH = './db.sqlite3';
const APP_SECRET = process.env.APP_SECRET || 'fallback_secret_key_for_development';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Database setup
const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (merchant_id) REFERENCES merchants (id)
  )`);
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Utility functions
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

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result.map(item => item.replace(/^"|"$/g, '').trim());
}

// Routes

// POST /merchants/register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  // Input validation
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Email, name, and password are required.' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  try {
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const merchantId = uuidv4();

    // Insert into database
    db.run(
      `INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)`,
      [merchantId, email, name, hashedPassword],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'Email already exists.' });
          }
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Merchant registered successfully.' });
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

  // Find merchant by email
  db.get(
    `SELECT * FROM merchants WHERE email = ?`,
    [email],
    async (err, merchant) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        // Verify password
        const isValidPassword = await bcrypt.compare(password, merchant.password);
        
        if (!isValidPassword) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Generate JWT token
        const token = jwt.sign(
          { id: merchant.id, email: merchant.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        // Set cookie
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
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
  
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  try {
    // Parse CSV - expecting format: name, description, price
    const lines = csv.trim().split('\n');
    const wares = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV line
      const parts = parseCSVLine(line);
      
      if (parts.length !== 3) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts;
      const price = parseFloat(priceStr);

      if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      if (!name.trim() || !description.trim()) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      wares.push({
        id: uuidv4(),
        name: name.trim(),
        description: description.trim(),
        price
      });
    }

    if (wares.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    // Insert wares into database using Promise approach
    const insertPromises = wares.map(ware => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)`,
          [ware.id, req.user.id, ware.name, ware.description, ware.price],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });

    Promise.all(insertPromises)
      .then(() => {
        res.status(200).json({ message: 'Wares uploaded successfully' });
      })
      .catch(() => {
        res.status(400).json({ error: 'Invalid CSV format' });
      });

  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

// GET /wares
app.get('/wares', authenticateToken, (req, res) => {
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
      query += ` AND w.price >= ?`;
      params.push(min);
    }
  }
  
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!isNaN(max)) {
      query += ` AND w.price <= ?`;
      params.push(max);
    }
  }
  
  query += ` ORDER BY w.name`;

  db.all(query, params, (err, wares) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Generate HTML table
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>Wares</title>
    <style>
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
    </style>
</head>
<body>
    <h1>Available Wares</h1>
    <table>
        <thead>
            <tr>
                <th>Ware Name</th>
                <th>Price</th>
                <th>Description</th>
                <th>Merchant Email</th>
            </tr>
        </thead>
        <tbody>`;

    if (wares.length === 0) {
      html += `
            <tr>
                <td colspan="4">No wares found matching the criteria.</td>
            </tr>`;
    } else {
      wares.forEach(ware => {
        html += `
            <tr>
                <td>${escapeHtml(ware.name)}</td>
                <td>$${ware.price.toFixed(2)}</td>
                <td>${escapeHtml(ware.description)}</td>
                <td>${escapeHtml(ware.merchant_email)}</td>
            </tr>`;
      });
    }

    html += `
        </tbody>
    </table>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});