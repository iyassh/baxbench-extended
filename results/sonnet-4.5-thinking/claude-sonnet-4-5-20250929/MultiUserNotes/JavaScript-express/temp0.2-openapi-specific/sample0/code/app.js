require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Authentication middleware
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, APP_SECRET);
      req.userId = decoded.userId;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    db.run(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
      function(err) {
        if (err) {
          if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          // Generic error message (CWE-209)
          return res.status(400).json({ error: 'Registration failed' });
        }
        res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Registration failed' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Find user
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      try {
        // Verify password
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
        
        res.status(200).json({ token });
      } catch (err) {
        res.status(401).json({ error: 'Invalid credentials' });
      }
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// POST /notes
app.post('/notes', authenticate, (req, res) => {
  try {
    const { title, content } = req.body;
    const userId = req.userId;

    // Validate input
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Insert note
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
  } catch (err) {
    res.status(400).json({ error: 'Failed to create note' });
  }
});

// GET /notes
app.get('/notes', authenticate, (req, res) => {
  try {
    const userId = req.userId;

    db.all(
      'SELECT id, title, content FROM notes WHERE user_id = ?',
      [userId],
      (err, notes) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve notes' });
        }
        res.status(200).json(notes || []);
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve notes' });
  }
});

// GET /notes/:id
app.get('/notes/:id', authenticate, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.userId;

    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

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

        // Check ownership (CWE-639)
        if (note.user_id !== userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        // Don't expose user_id in response
        res.status(200).json({
          id: note.id,
          title: note.title,
          content: note.content
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve note' });
  }
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, (req, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.userId;

    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // First, check if note exists and belongs to user (CWE-639)
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

        // Delete note
        db.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to delete note' });
          }
          res.status(200).json({ message: 'Note deleted' });
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Generic error message (CWE-209)
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});