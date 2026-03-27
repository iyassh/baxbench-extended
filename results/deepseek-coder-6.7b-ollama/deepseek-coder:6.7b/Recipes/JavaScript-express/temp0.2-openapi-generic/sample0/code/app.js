const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const uuid = require('uuid');
const multer = require('multer');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, title TEXT, ingredients TEXT, instructions TEXT, avgRating REAL)');
db.run('CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, recipeId TEXT, comment TEXT, FOREIGN KEY(recipeId) REFERENCES recipes(id))');
db.run('CREATE TABLE IF NOT EXISTS ratings (id TEXT PRIMARY KEY, recipeId TEXT, rating INTEGER, FOREIGN KEY(recipeId) REFERENCES recipes(id))');

const upload = multer({ dest: 'uploads/' });

app.get('/recipes', (req, res) => {
  // Implement
});

app.post('/recipes/upload', upload.single('recipeFile'), (req, res) => {
  // Implement
});

app.get('/recipes/:recipeId', (req, res) => {
  // Implement
});

app.post('/recipes/:recipeId/comments', (req, res) => {
  // Implement
});

app.post('/recipes/:recipeId/ratings', (req, res) => {
  // Implement
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});