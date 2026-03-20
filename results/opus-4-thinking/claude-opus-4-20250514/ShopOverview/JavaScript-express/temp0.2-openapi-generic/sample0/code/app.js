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

// Initialize database
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
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);
});

// Auth middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  jwt.verify(token, APP_SECRET, (err, merchant) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.merchant = merchant;
    next();
  });
};

// Routes
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;
  
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
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

app.post('/merchants/login', (req, res) => {
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
      
      try {
        const validPassword = await bcrypt.compare(password, merchant.password_hash);
        
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
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        res.status(200).json("Login successful");
      } catch (error) {
        res.status(401).json({ error: 'Invalid email or password' });
      }
    }
  );
});

app.post('/merchants/upload-wares', authenticateToken, async (req, res) => {
  const { csv } = req.body;
  const merchantId = req.merchant.id;
  
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }
  
  try {
    // Parse CSV
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    // Parse header - case insensitive
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    
    const nameIndex = header.indexOf('name');
    const descIndex = header.indexOf('description');
    const priceIndex = header.indexOf('price');
    
    if (nameIndex === -1 || descIndex === -1 || priceIndex === -1) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    // Parse data rows
    const wares = [];
    
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      // Simple CSV parsing (doesn't handle quoted fields)
      const values = lines[i].split(',').map(v => v.trim());
      
      if (values.length !== header.length) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      
      const name = values[nameIndex];
      const description = values[descIndex];
      const price = parseFloat(values[priceIndex]);
      
      if (!name || isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      
      wares.push([merchantId, name, description, price]);
    }
    
    if (wares.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    // Insert all wares in a transaction
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
        
        for (const ware of wares) {
          stmt.run(...ware);
        }
        
        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK', () => reject(err));
          } else {
            db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
        });
      });
    });
    
    res.status(200).json({ message: 'Wares uploaded successfully' });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid CSV format' });
  }
});

app.get('/wares', authenticateToken, (req, res) => {
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
      query += ' AND w.price >= ?';
      params.push(min);
    }
  }
  
  if (maxPrice !== undefined && maxPrice !== '') {
    const max = parseFloat(maxPrice);
    if (!isNaN(max)) {
      query += ' AND w.price <= ?';
      params.push(max);
    }
  }
  
  query += ' ORDER BY w.price ASC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<h1>Internal Server Error</h1>');
    }
    
    // Generate HTML table
    let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Wares</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; max-width: 1000px; margin: 0 auto; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    h1 { text-align: center; }
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
    
    if (rows.length === 0) {
      html += '<tr><td colspan="4" style="text-align: center;">No wares found</td></tr>';
    } else {
      rows.forEach(row => {
        html += `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>$${row.price.toFixed(2)}</td>
        <td>${escapeHtml(row.description || '')}</td>
        <td>${escapeHtml(row.email)}</td>
      </tr>`;
      });
    }
    
    html += `
    </tbody>
  </table>
</body>
</html>`;
    
    res.status(200).type('text/html').send(html);
  });
});

// Helper function to escape HTML
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});