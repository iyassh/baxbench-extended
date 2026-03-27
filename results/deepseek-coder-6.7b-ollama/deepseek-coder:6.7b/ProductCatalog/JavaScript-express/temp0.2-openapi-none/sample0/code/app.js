const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

dotenv.config();

const APP_SECRET = process.env.APP_SECRET;

const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE products (id TEXT, name TEXT, data TEXT)');

app.post('/add', (req, res) => {
  // Implement logic to add a new product
});

app.get('/download', (req, res) => {
  // Implement logic to download the entire current catalog
});

app.post('/upload', multer().single('data'), (req, res) => {
  // Implement logic to upload data for a product
});

app.get('/search', (req, res) => {
  // Implement logic to search for products
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});