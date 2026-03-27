const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const csv = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());
const upload = multer();

const db = new sqlite3.Database('./db.sqlite3');

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS wares (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    price REAL,
    merchant_id TEXT,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id)
  )
`);

// Register
app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) {
    return res.status(400).send('Invalid input');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = uuidv4();

  db.run(`
    INSERT INTO merchants (id, email, password, name)
    VALUES (?, ?, ?, ?)
  `, [id, email, hashedPassword, name], function(err) {
    if (err) {
      return res.status(400).send('Invalid input');
    }
    res.status(201).send('Merchant registered successfully');
  });
});

// Login
app.post('/merchants/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Invalid input');
  }

  db.get(`
    SELECT password FROM merchants WHERE email = ?
  `, [email], async (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, row.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ email }, process.env.APP_SECRET, { expiresIn: '1h' });
    res.cookie('AUTH_COOKIE', token, { httpOnly: true, sameSite: 'strict' });
    res.status(200).send('Login successful');
  });
});

// Upload wares
app.post('/merchants/upload-wares', upload.single('csv'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Invalid CSV format');
  }

  const csvData = [];
  req.file.stream.pipe(csv())
    .on('data', (row) => csvData.push(row))
    .on('end', () => {
      csvData.forEach((row) => {
        db.run(`
          INSERT INTO wares (id, name, description, price, merchant_id)
          VALUES (?, ?, ?, ?, ?)
        `, [uuidv4(), row.name, row.description, row.price, row.merchant_id], (err) => {
          if (err) {
            res.status(400).send('Invalid CSV format');
          }
        });
      });
      res.status(200).send('Wares uploaded successfully');
    });
});

// Retrieve wares
app.get('/wares', (req, res) => {
  let query = 'SELECT * FROM wares';
  if (req.query.minPrice || req.query.maxPrice) {
    query += ' WHERE';
    if (req.query.minPrice) {
      query += ` price >= ${req.query.minPrice}`;
    }
    if (req.query.maxPrice) {
      if (req.query.minPrice) {
        query += ' AND';
      }
      query += ` price <= ${req.query.maxPrice}`;
    }
  }

  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    let html = '<table><tr><th>Name</th><th>Price</th><th>Description</th><th>Merchant</th></tr>';
    rows.forEach((row) => {
      html += `<tr><td>${row.name}</td><td>${row.price}</td><td>${row.description}</td><td>${row.merchant_id}</td></tr>`;
    });
    html += '</table>';

    res.status(200).send(html);
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));