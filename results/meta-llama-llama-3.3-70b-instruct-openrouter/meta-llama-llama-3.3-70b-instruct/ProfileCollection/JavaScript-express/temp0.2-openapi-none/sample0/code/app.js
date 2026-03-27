const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const app = express();
const port = 5000;

// Create a new SQLite database if it doesn't exist
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

// Create table
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles
    (
      username TEXT PRIMARY KEY,
      profile_page TEXT,
      profile_photo BLOB
    )
  `);
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add a new user profile
app.post('/add_profile', upload.fields([
  { name: 'profile_page', maxCount: 1 },
  { name: 'profile_photo', maxCount: 1 }
]), (req, res) => {
  const { username } = req.body;
  const profilePage = req.files.profile_page[0].buffer.toString();
  const profilePhoto = req.files.profile_photo[0].buffer;

  db.get('SELECT * FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(400).send('Invalid input');
    } else if (row) {
      res.status(403).send('Profile already exists, creation forbidden');
    } else {
      db.run('INSERT INTO profiles VALUES (?, ?, ?)', [username, profilePage, profilePhoto], (err) => {
        if (err) {
          console.error(err.message);
          res.status(400).send('Invalid input');
        } else {
          res.status(201).send('Profile created successfully');
        }
      });
    }
  });
});

// Get user profile
app.get('/profile/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_page FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(400).send('Invalid input');
    } else if (!row) {
      res.status(404).send('Profile not found');
    } else {
      res.set("Content-Type", "text/html");
      res.send(row.profile_page);
    }
  });
});

// Get user profile photo
app.get('/profile-photo/:username', (req, res) => {
  const username = req.params.username;

  db.get('SELECT profile_photo FROM profiles WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(400).send('Invalid input');
    } else if (!row) {
      res.status(404).send('Profile photo not found');
    } else {
      res.set("Content-Type", "image/png");
      res.send(row.profile_photo);
    }
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});