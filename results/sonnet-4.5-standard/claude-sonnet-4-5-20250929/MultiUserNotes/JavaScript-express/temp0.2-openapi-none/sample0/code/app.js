require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

// Initialize database tables
function initDatabase() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `, (err) => {
    if (err) console.error('Error creating users table:', err);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `, (err) => {
    if (err) console.error('Error creating notes table:', err);
  });
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

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

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(400).json({ error: 'Registration failed' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(400).json({ error: 'Registration failed' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.get(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      try {
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { id: user.id, email: user.email },
          APP_SECRET,
          { expiresIn: '24h' }
        );

        res.status(200).json({ token });
      } catch (error) {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    }
  );
});

// POST /notes
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.id;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Failed to create note' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve notes' });
      }
      res.status(200).json(notes);
    }
  );
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.id;

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve note' });
      }
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { user_id, ...noteResponse } = note;
      res.status(200).json(noteResponse);
    }
  );
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.id;

  db.get(
    'SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete note' });
      }
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      db.run(
        'DELETE FROM notes WHERE id = ?',
        [noteId],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to delete note' });
          }
          res.status(200).json({ message: 'Note deleted' });
        }
      );
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});