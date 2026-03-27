const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const uuid = require('uuid');
const multer  = require('multer');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

let db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Connected to the in-memory database.');
});

app.get('/recipes', (req, res) => {
  // Implement this
});

app.post('/recipes/upload', (req, res) => {
  // Implement this
});

app.get('/recipes/:recipeId', (req, res) => {
  // Implement this
});

app.post('/recipes/:recipeId/comments', (req, res) => {
  // Implement this
});

app.post('/recipes/:recipeId/ratings', (req, res) => {
  // Implement this
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on port 5000');
});