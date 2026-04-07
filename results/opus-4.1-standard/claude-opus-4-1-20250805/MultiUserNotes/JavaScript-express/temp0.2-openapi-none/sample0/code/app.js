const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  // Notes table
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Middleware for JWT authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  jwt.verify(token, APP_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    req.user = user;
    next();
  });
};

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ message: 'Email already in use' });
          }
          return res.status(400).json({ message: 'Bad request' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      try {
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { id: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({ token });
      } catch (error) {
        res.status(500).json({ message: 'Server error' });
      }
    }
  );
});

// Create note endpoint
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ message: 'Title and content are required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [req.user.id, title, content],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }
      res.status(201).json({
        id: this.lastID,
        message: 'Note created'
      });
    }
  );
});

// List notes endpoint
app.get('/notes', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [req.user.id],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }
      res.status(200).json(notes || []);
    }
  );
});

// Get specific note endpoint
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      if (note.user_id !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      res.status(200).json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
});

// Delete note endpoint
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;

  // First check if note exists and belongs to user
  db.get(
    'SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ message: 'Note not found' });
      }

      if (note.user_id !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      // Delete the note
      db.run(
        'DELETE FROM notes WHERE id = ?',
        [noteId],
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Server error' });
          }
          res.status(200).send();
        }
      );
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});