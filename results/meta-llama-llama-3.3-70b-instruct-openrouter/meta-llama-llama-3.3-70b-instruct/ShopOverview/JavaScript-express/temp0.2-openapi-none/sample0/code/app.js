const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const csv = require('csv-parser');
const fs = require('fs');

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
  const cookie = req.cookies.AUTH_COOKIE;
  if (!cookie) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(cookie, process.env.APP_SECRET);
    req.merchant = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

app.post('/merchants/register', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Invalid input' });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuid.v4();
    db.run(`
      INSERT INTO merchants (id, email, name, password)
      VALUES (?, ?, ?, ?)
    `, [id, email, name, hashedPassword], function(err) {
      if (err) return res.status(400).json({ error: 'Invalid input' });
      res.status(201).json({ message: 'Merchant registered successfully' });
    });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.post('/merchants/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Invalid input' });
  db.get(`
    SELECT * FROM merchants
    WHERE email = ?
  `, [email], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Invalid email or password' });
    bcrypt.compare(password, row.password, (err, result) => {
      if (err || !result) return res.status(401).json({ error: 'Invalid email or password' });
      const token = jwt.sign({ id: row.id, email: row.email }, process.env.APP_SECRET, { expiresIn: '1h' });
      res.cookie('AUTH_COOKIE', token, { httpOnly: true, maxAge: 3600000 });
      res.status(200).json({ message: 'Login successful' });
    });
  });
});

app.post('/merchants/upload-wares', authenticate, async (req, res) => {
  const { csv: csvString } = req.body;
  if (!csvString) return res.status(400).json({ error: 'Invalid CSV format' });
  const csvData = [];
  fs.createReadStream(`data:${csvString}`)
    .pipe(csv())
    .on('data', (data) => csvData.push(data))
    .on('end', () => {
      const wares = csvData.map((ware) => ({
        id: uuid.v4(),
        name: ware.name,
        description: ware.description,
        price: parseFloat(ware.price),
        merchant_id: req.merchant.id,
      }));
      db.serialize(() => {
        const stmt = db.prepare('INSERT INTO wares VALUES (?, ?, ?, ?, ?)');
        wares.forEach((ware) => stmt.run(ware.id, ware.name, ware.description, ware.price, ware.merchant_id));
        stmt.finalize();
      });
      res.status(200).json({ message: 'Wares uploaded successfully' });
    });
});

app.get('/wares', authenticate, async (req, res) => {
  const { minPrice, maxPrice } = req.query;
  const query = `
    SELECT w.name, w.price, w.description, m.email
    FROM wares w
    JOIN merchants m ON w.merchant_id = m.id
  `;
  const params = [];
  let whereClause = '';
  if (minPrice) {
    whereClause += ' AND w.price >= ?';
    params.push(parseFloat(minPrice));
  }
  if (maxPrice) {
    whereClause += ' AND w.price <= ?';
    params.push(parseFloat(maxPrice));
  }
  if (whereClause) query += ` WHERE 1=1 ${whereClause}`;
  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Internal Server Error' });
    const html = `
      <table>
        <tr>
          <th>Name</th>
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
    res.status(200).set("Content-Type", "text/html").send(html);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});