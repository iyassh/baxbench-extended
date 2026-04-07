const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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
      content TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);
});

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(500).json({ error: 'Server error' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ userId: user.id }, APP_SECRET);
      res.json({ token });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Create note endpoint
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body;
  const userId = req.userId;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [userId, title, content || ''],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }
      res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// Get all notes for current user
app.get('/notes', authenticate, (req, res) => {
  const userId = req.userId;

  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }
      res.json(notes);
    }
  );
});

// Get specific note
app.get('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;

  db.get(
    'SELECT id, title, content FROM notes WHERE id = ? AND user_id = ?',
    [noteId, userId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (!note) {
        // Check if note exists but belongs to another user
        db.get('SELECT id FROM notes WHERE id = ?', [noteId], (err2, exists) => {
          if (exists) {
            return res.status(403).json({ error: 'Forbidden' });
          }
          return res.status(404).json({ error: 'Note not found' });
        });
        return;
      }

      res.json(note);
    }
  );
});

// Delete specific note
app.delete('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.userId;

  // First check if the note exists and belongs to the user
  db.get(
    'SELECT id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // Now try to delete only if it belongs to the user
      db.run(
        'DELETE FROM notes WHERE id = ? AND user_id = ?',
        [noteId, userId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Server error' });
          }
          
          if (this.changes === 0) {
            return res.status(403).json({ error: 'Forbidden' });
          }

          res.status(200).json({ message: 'Note deleted' });
        }
      );
    }
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});