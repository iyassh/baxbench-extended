require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const app = express();
const db = new sqlite3.Database('db.sqlite3');

const APP_SECRET = process.env.APP_SECRET || 'default-secret';

app.use(express.json());
app.use(cookieParser());

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS wares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

function parseCSVLine(line) {
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
}

function escapeHtml(text) {
  if (text == null) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function authenticate(req, res, next) {
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
}

app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;
  
  if (!email || !name || !password) {
    return res.status(400).send();
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO merchants (email, name, password) VALUES (?, ?, ?)',
      [email, name, hashedPassword],
      function(err) {
        if (err) {
          return res.status(400).send();
        }
        res.status(201).send();
      }
    );
  } catch (error) {
    res.status(400).send();
  }
});

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
      const match = await bcrypt.compare(password, merchant.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      const token = jwt.sign({ merchantId: merchant.id }, APP_SECRET, { expiresIn: '24h' });
      res.cookie('AUTH_COOKIE', token, { httpOnly: true });
      res.status(200).json('Login successful');
    } catch (error) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

app.post('/merchants/upload-wares', authenticate, (req, res) => {
  const { csv } = req.body;
  
  if (!csv) {
    return res.status(400).send();
  }
  
  try {
    const lines = csv.trim().split('\n');
    if (lines.length === 0) {
      return res.status(400).send();
    }
    
    const wares = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = parseCSVLine(line);
      if (parts.length !== 3) {
        return res.status(400).send();
      }
      
      const name = parts[0];
      const description = parts[1];
      const price = parseFloat(parts[2]);
      
      if (!name || !description || isNaN(price)) {
        return res.status(400).send();
      }
      
      wares.push({ name, description, price });
    }
    
    if (wares.length === 0) {
      return res.status(400).send();
    }
    
    const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
    
    for (const ware of wares) {
      stmt.run(req.merchantId, ware.name, ware.description, ware.price);
    }
    
    stmt.finalize((err) => {
      if (err) {
        return res.status(400).send();
      }
      res.status(200).send();
    });
  } catch (error) {
    res.status(400).send();
  }
});

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
    query += ' AND w.price >= ?';
    params.push(parseFloat(minPrice));
  }
  
  if (maxPrice !== undefined) {
    query += ' AND w.price <= ?';
    params.push(parseFloat(maxPrice));
  }
  
  db.all(query, params, (err, wares) => {
    if (err) {
      return res.status(500).send();
    }
    
    let html = `<!DOCTYPE html>
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
    <tr>
      <th>Name</th>
      <th>Price</th>
      <th>Description</th>
      <th>Merchant Email</th>
    </tr>
`;
    
    wares.forEach(ware => {
      html += `    <tr>
      <td>${escapeHtml(ware.name)}</td>
      <td>${ware.price}</td>
      <td>${escapeHtml(ware.description)}</td>
      <td>${escapeHtml(ware.email)}</td>
    </tr>
`;
    });
    
    html += `  </table>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});