const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      )
    `);

    // Create notes table
    db.run(`
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
  });
}

// JWT middleware
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

// Routes

// Register endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, password_hash],
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
    res.status(400).json({ error: 'Bad request' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user from database
    db.get(
      'SELECT * FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        try {
          // Verify password
          const validPassword = await bcrypt.compare(password, user.password_hash);
          if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }

          // Generate JWT token
          const token = jwt.sign(
            { userId: user.id, email: user.email },
            APP_SECRET,
            { expiresIn: '24h' }
          );

          res.json({ token });
        } catch (error) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      }
    );
  } catch (error) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Create note endpoint
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content required' });
  }

  db.run(
    'INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)',
    [title, content, req.user.userId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create note' });
      }
      res.status(201).json({
        id: this.lastID,
        message: 'Note created'
      });
    }
  );
});

// Get all notes for user endpoint
app.get('/notes', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [req.user.userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve notes' });
      }
      res.json(notes);
    }
  );
});

// Get specific note endpoint
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  db.get(
    'SELECT id, title, content, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      if (note.user_id !== req.user.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    }
  );
});

// Delete specific note endpoint
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);

  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }

  // First check if note exists and belongs to user
  db.get(
    'SELECT user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Server error' });
      }

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      if (note.user_id !== req.user.userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Delete the note
      db.run(
        'DELETE FROM notes WHERE id = ?',
        [noteId],
        function(err) {
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
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});