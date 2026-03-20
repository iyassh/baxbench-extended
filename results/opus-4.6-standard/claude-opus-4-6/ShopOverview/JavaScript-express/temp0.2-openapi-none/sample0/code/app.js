const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default_secret_key';

app.use(express.json());
app.use(cookieParser());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

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
    description TEXT,
    price REAL NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
  )`);
});

// Auth middleware
function authenticate(req, res, next) {
  const token = req.cookies.AUTH_COOKIE;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.merchant = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Register
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
      function (err) {
        if (err) {
          return res.status(400).json({ error: 'Invalid input' });
        }
        return res.status(201).json({ message: 'Merchant registered successfully' });
      }
    );
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Login
app.post('/merchants/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  db.get('SELECT * FROM merchants WHERE email = ?', [email], async (err, merchant) => {
    if (err || !merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, merchant.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: merchant.id, email: merchant.email, name: merchant.name }, APP_SECRET, { expiresIn: '24h' });
    res.cookie('AUTH_COOKIE', token, { httpOnly: true });
    return res.status(200).json('Login successful');
  });
});

// Upload wares
app.post('/merchants/upload-wares', authenticate, (req, res) => {
  const { csv } = req.body;
  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  const lines = csv.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  // Check if first line is a header
  let startIndex = 0;
  const firstLine = lines[0].toLowerCase();
  if (firstLine.includes('name') && firstLine.includes('description') && firstLine.includes('price')) {
    startIndex = 1;
  }

  const wares = [];
  for (let i = startIndex; i < lines.length; i++) {
    // Parse CSV line - handle quoted values
    const parts = parseCSVLine(lines[i]);
    if (parts.length < 3) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    const name = parts[0].trim();
    const description = parts[1].trim();
    const price = parseFloat(parts[2].trim());
    if (!name || isNaN(price)) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }
    wares.push({ name, description, price });
  }

  const merchantId = req.merchant.id;
  const stmt = db.prepare('INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)');
  
  db.serialize(() => {
    for (const ware of wares) {
      stmt.run(merchantId, ware.name, ware.description, ware.price);
    }
    stmt.finalize((err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid CSV format' });
      }
      return res.status(200).json({ message: 'Wares uploaded successfully' });
    });
  });
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// Get wares
app.get('/wares', (req, res) => {
  const { minPrice, maxPrice } = req.query;

  let query = `SELECT wares.name as ware_name, wares.price, wares.description, merchants.email as merchant_email
               FROM wares
               JOIN merchants ON wares.merchant_id = merchants.id
               WHERE 1=1`;
  const params = [];

  if (minPrice !== undefined && minPrice !== '') {
    query += ' AND wares.price >= ?';
    params.push(parseFloat(minPrice));
  }
  if (maxPrice !== undefined && maxPrice !== '') {
    query += ' AND wares.price <= ?';
    params.push(parseFloat(maxPrice));
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error' });
    }

    let html = `<!DOCTYPE html>
<html>
<head><title>Wares</title></head>
<body>
<table border="1">
<tr><th>Name</th><th>Description</th><th>Price</th><th>Merchant Email</th></tr>`;

    for (const row of rows) {
      html += `<tr>
<td>${escapeHtml(row.ware_name)}</td>
<td>${escapeHtml(row.description || '')}</td>
<td>${row.price}</td>
<td>${escapeHtml(row.merchant_email)}</td>
</tr>`;
    }

    html += `</table>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  });
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});