const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const multer = require('multer');
const csv = require('csv-parser');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());
const db = new sqlite3.Database('./db.sqlite3');

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS merchants
    (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wares
    (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      merchant_id TEXT NOT NULL,
      FOREIGN KEY (merchant_id) REFERENCES merchants (id)
    )
  `);
});

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.AUTH_COOKIE;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const decoded = jwt.verify(token, process.env.APP_SECRET);
    req.merchantId = decoded.merchantId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/merchants/register', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuid.v4();
    db.run(`
      INSERT INTO merchants (id, email, name, password)
      VALUES (?, ?, ?, ?)
    `, [id, email, name, hashedPassword], function(err) {
      if (err) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      res.status(201).json({ message: 'Merchant registered successfully' });
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.post('/merchants/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    db.get(`
      SELECT id, password
      FROM merchants
      WHERE email = ?
    `, [email], (err, row) => {
      if (err || !row) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      bcrypt.compare(password, row.password, (err, result) => {
        if (err || !result) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = jwt.sign({ merchantId: row.id }, process.env.APP_SECRET, { expiresIn: '1h' });
        res.cookie('AUTH_COOKIE', token, { httpOnly: true, secure: true });
        res.json({ message: 'Login successful' });
      });
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid input' });
  }
});

app.post('/merchants/upload-wares', authenticate, async (req, res) => {
  try {
    const csvString = req.body.csv;
    const wares = [];
    csvString.split('\n').forEach((row) => {
      const [name, description, price] = row.split(',');
      wares.push({ name, description, price: parseFloat(price) });
    });
    const merchantId = req.merchantId;
    db.serialize(function() {
      wares.forEach((ware) => {
        const id = uuid.v4();
        db.run(`
          INSERT INTO wares (id, name, description, price, merchant_id)
          VALUES (?, ?, ?, ?, ?)
        `, [id, ware.name, ware.description, ware.price, merchantId]);
      });
    });
    res.json({ message: 'Wares uploaded successfully' });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid CSV format' });
  }
});

app.get('/wares', authenticate, async (req, res) => {
  try {
    const minPrice = req.query.minPrice;
    const maxPrice = req.query.maxPrice;
    let query = `
      SELECT w.name, w.price, w.description, m.email
      FROM wares w
      JOIN merchants m ON w.merchant_id = m.id
    `;
    const params = [];
    if (minPrice) {
      query += ' WHERE w.price >= ?';
      params.push(minPrice);
    }
    if (maxPrice) {
      if (params.length > 0) {
        query += ' AND w.price <= ?';
      } else {
        query += ' WHERE w.price <= ?';
      }
      params.push(maxPrice);
    }
    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      const html = `
        <table>
          <tr>
            <th>Ware Name</th>
            <th>Price</th>
            <th>Description</th>
            <th>Merchant Email</th>
          </tr>
          ${rows.map((row) => `
            <tr>
              <td>${row.name}</td>
              <td>${row.price}</td>
              <td>${row.description}</td>
              <td>${row.email}</td>
            </tr>
          `).join('')}
        </table>
      `;
      res.set("Content-Type", "text/html");
      res.send(html);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});