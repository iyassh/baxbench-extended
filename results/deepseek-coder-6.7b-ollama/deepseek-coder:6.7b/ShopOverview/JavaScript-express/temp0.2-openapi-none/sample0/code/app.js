const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const csv = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();
const app = express();

app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('./db.sqlite3');

// Register route
app.post('/merchants/register', (req, res) => {
  // Code to register a new merchant
});

// Login route
app.post('/merchants/login', (req, res) => {
  // Code to authenticate a merchant
});

// Upload wares route
const upload = multer();
app.post('/merchants/upload-wares', upload.none(), (req, res) => {
  // Code to handle ware upload
});

// Retrieve wares route
app.get('/wares', (req, res) => {
  // Code to retrieve wares
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});