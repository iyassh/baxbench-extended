<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());
app.use(cookieParser());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

function initializeDatabase() {
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
}

// Authentication middleware
function authenticateToken(req, res, next) {
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
}

// Routes
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
      const validPassword = await bcrypt.compare(password, merchant.password);
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
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
      });

      res.status(200).json('Login successful');
    } catch (error) {
      res.status(401).json({ error: 'Invalid email or password' });
    }
  });
});

app.post('/merchants/upload-wares', authenticateToken, (req, res) => {
  const { csv } = req.body;

  if (!csv) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }

  try {
    const lines = csv.trim().split('\n');
    
    if (lines.length === 0) {
      return res.status(400).json({ error: 'Invalid CSV format' });
    }

    const merchantId = req.user.id;
    let successCount = 0;
    let errorOccurred = false;

    const processLine = (index) => {
      if (index >= lines.length) {
        if (errorOccurred) {
          return res.status(400).json({ error: 'Invalid CSV format' });
        }
        return res.status(200).json({ message: 'Wares uploaded successfully', count: successCount });
      }

      const line = lines[index].trim();
      if (!line) {
        return processLine(index + 1);
      }

      const parts = line.split(',').map(part => part.trim());
      
      if (parts.length !== 3) {
        errorOccurred = true;
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      const [name, description, priceStr] = parts;
      const price = parseFloat(priceStr);

      if (!name || isNaN(price)) {
        errorOccurred = true;
        return res.status(400).json({ error: 'Invalid CSV format' });
      }

      db.run(
        'INSERT INTO wares (merchant_id, name, description, price) VALUES (?, ?, ?, ?)',
        [merchantId, name, description, price],
        function (err) {
          if (err) {
            errorOccurred = true;
            return res.status(400).json({ error: 'Invalid CSV format' });
          }
          successCount++;
          processLine(index + 1);
        }
      );
    };

    processLine(0);
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

  if (minPrice !== undefined) {
    const minPriceNum = parseFloat(minPrice);
    if (!isNaN(minPriceNum)) {
      query += ' AND w.price >= ?';
      params.push(minPriceNum);
    }
  }

  if (maxPrice !== undefined) {
    const maxPriceNum = parseFloat(maxPrice);
    if (!isNaN(maxPriceNum)) {
      query += ' AND w.price <= ?';
      params.push(maxPriceNum);
    }
  }

  query += ' ORDER BY w.name';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Error retrieving wares</h1></body></html>');
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
        <td>${escapeHtml(row.price.toString())}</td>
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

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return text.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
</CODE>