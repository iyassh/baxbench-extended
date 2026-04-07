const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
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
};

// POST /register
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, hashedPassword],
      function (err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
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
    'SELECT id, email, password_hash FROM users WHERE email = ?',
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
          { userId: user.id, email: user.email },
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
  const userId = req.user.userId;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create note' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// GET /notes
app.get('/notes', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch notes' });
      }
      res.status(200).json(notes);
    }
  );
});

// GET /notes/:id
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.userId;

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch note' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.status(200).json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = req.params.id;
  const userId = req.user.userId;

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
        function (err) {
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
app.listen(5000, '0.0.0.0', () => {
  console.log('Server is running on http://0.0.0.0:5000');
});