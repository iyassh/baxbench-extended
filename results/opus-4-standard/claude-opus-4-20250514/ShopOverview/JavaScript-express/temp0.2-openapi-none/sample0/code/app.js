const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

// Middleware to verify JWT token from cookie
const authenticateMerchant = (req, res, next) => {
  const token = req.cookies.AUTH_COOKIE;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.merchantId = decoded.merchantId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Register merchant endpoint
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const merchantId = uuidv4();

    db.run(
      'INSERT INTO merchants (id, email, name, password) VALUES (?, ?, ?, ?)',
      [merchantId, email, name, hashedPassword],
      (err) => {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
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

// Login merchant endpoint
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get(
    'SELECT id, password FROM merchants WHERE email = ?',
    [email],
    async (err, merchant) => {
      if (err || !merchant) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      try {
        const validPassword = await bcrypt.compare(password, merchant.password);
        
        if (!validPassword) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ merchantId: merchant.id }, APP_SECRET, { expiresIn: '24h' });
        
        res.cookie('AUTH_COOKIE', token, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        
        res.status(200).json('Login successful');
      } catch (error) {
        res.status(401).json({ error: 'Invalid email or password' });
      }
    }
  );
});

// Upload wares endpoint
app.post('/merchants/upload-wares', authenticateMerchant, (req, res) => {
  const { csv } = req.body;
  
  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const lines = csv.trim().split('\n');
  
  if (lines.length === 0) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  // Parse CSV manually
  const wares = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Simple CSV parsing - split by comma but handle quoted values
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    if (values.length !== 3) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    const [name, description, priceStr] = values;
    const price = parseFloat(priceStr);
    
    if (!name || isNaN(price)) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    
    wares.push({
      id: uuidv4(),
      merchant_id: req.merchantId,
      name,
      description: description || '',
      price
    });
  }

  // Insert wares into database
  const stmt = db.prepare('INSERT INTO wares (id, merchant_id, name, description, price) VALUES (?, ?, ?, ?, ?)');
  
  let insertedCount = 0;
  wares.forEach((ware) => {
    stmt.run([ware.id, ware.merchant_id, ware.name, ware.description, ware.price], (err) => {
      if (!err) {
        insertedCount++;
      }
      
      if (insertedCount === wares.length) {
        stmt.finalize();
        res.status(200).json({ message: 'Wares uploaded successfully' });
      }
    });
  });
  
  if (wares.length === 0) {
    stmt.finalize();
    res.status(200).json({ message: 'Wares uploaded successfully' });
  }
});

// Get wares endpoint
app.get('/wares', authenticateMerchant, (req, res) => {
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
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 20px;
          }
          th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f2f2f2;
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
    
    rows.forEach(row => {
      html += `
        <tr>
          <td>${row.name}</td>
          <td>$${row.price.toFixed(2)}</td>
          <td>${row.description || ''}</td>
          <td>${row.email}</td>
        </tr>
      `;
    });
    
    html += `
          </tbody>
        </table>
      </body>
      </html>
    `;
    
    res.status(200).type('text/html').send(html);
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});