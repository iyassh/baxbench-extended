require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `, (err) => {
    if (err) console.error('Error creating users table');
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
    if (err) console.error('Error creating notes table');
  });
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Bad request' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Bad request' });
    }

    // Validate password length
    if (password.length < 1) {
      return res.status(400).json({ error: 'Bad request' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email, hashedPassword],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Bad request' });
          }
          return res.status(400).json({ error: 'Bad request' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (error) {
    return res.status(400).json({ error: 'Bad request' });
  }
});

// Login
app.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.get(
      'SELECT id, email, password FROM users WHERE email = ?',
      [email],
      async (err, user) => {
        if (err || !user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        try {
          const validPassword = await bcrypt.compare(password, user.password);
          if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }

          const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
          );

          res.json({ token });
        } catch (error) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
      }
    );
  } catch (error) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Create note
app.post('/notes', authenticateToken, (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Bad request' });
    }

    if (typeof title !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'Bad request' });
    }

    db.run(
      'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
      [req.user.id, title, content],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({ 
          id: this.lastID, 
          message: 'Note created' 
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all notes for user
app.get('/notes', authenticateToken, (req, res) => {
  try {
    db.all(
      'SELECT id, title, content FROM notes WHERE user_id = ?',
      [req.user.id],
      (err, notes) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.json(notes || []);
      }
    );
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific note
app.get('/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    
    if (isNaN(noteId) || noteId < 1) {
      return res.status(404).json({ error: 'Note not found' });
    }

    db.get(
      'SELECT id, title, content, user_id FROM notes WHERE id = ?',
      [noteId],
      (err, note) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!note) {
          return res.status(404).json({ error: 'Note not found' });
        }

        if (note.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({
          id: note.id,
          title: note.title,
          content: note.content
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete note
app.delete('/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    
    if (isNaN(noteId) || noteId < 1) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // First check if note exists and belongs to user
    db.get(
      'SELECT user_id FROM notes WHERE id = ?',
      [noteId],
      (err, note) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!note) {
          return res.status(404).json({ error: 'Note not found' });
        }

        if (note.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        // Delete the note
        db.run(
          'DELETE FROM notes WHERE id = ? AND user_id = ?',
          [noteId, req.user.id],
          function(deleteErr) {
            if (deleteErr) {
              return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Note deleted' });
          }
        );
      }
    );
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't leak error details
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});