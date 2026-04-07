const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;

// Get app secret from environment or use a default
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-in-production';

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

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Error creating users table:', err.message);
  });

  // Notes table
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `, (err) => {
    if (err) console.error('Error creating notes table:', err.message);
  });

  // Create index for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id)`, (err) => {
    if (err) console.error('Error creating index:', err.message);
  });
});

// Helper function to verify JWT token
const verifyToken = (req, res, next) => {
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

// Helper function for database queries with promises
const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error occurred:', err.message);
  res.status(500).json({ error: 'Internal server error' });
};

// POST /register
app.post('/register', async (req, res, next) => {
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

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    try {
      const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert new user
    try {
      await dbRun(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)',
        [email, passwordHash]
      );
      res.status(201).json({ message: 'Registration successful' });
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      if (dbError.code === 'SQLITE_CONSTRAINT') {
        return res.status(400).json({ error: 'Email already in use' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    next(error);
  }
});

// POST /login
app.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Find user
    let user;
    try {
      user = await dbGet(
        'SELECT id, email, password_hash FROM users WHERE email = ?',
        [email]
      );
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
    next(error);
  }
});

// POST /notes
app.post('/notes', verifyToken, async (req, res, next) => {
  try {
    const { title, content } = req.body;
    const userId = req.userId;

    // Validate input
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Create note
    try {
      const result = await dbRun(
        'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
        [userId, title, content || '']
      );
      
      res.status(201).json({
        id: result.lastID,
        message: 'Note created'
      });
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    next(error);
  }
});

// GET /notes
app.get('/notes', verifyToken, async (req, res, next) => {
  try {
    const userId = req.userId;

    // Get all notes for the user
    try {
      const notes = await dbAll(
        'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
        [userId]
      );
      
      res.json(notes);
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    next(error);
  }
});

// GET /notes/:id
app.get('/notes/:id', verifyToken, async (req, res, next) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.userId;

    // Validate input
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Get note
    try {
      const note = await dbGet(
        'SELECT id, title, content, user_id FROM notes WHERE id = ?',
        [noteId]
      );

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // Check ownership
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      res.json({
        id: note.id,
        title: note.title,
        content: note.content
      });
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    next(error);
  }
});

// DELETE /notes/:id
app.delete('/notes/:id', verifyToken, async (req, res, next) => {
  try {
    const noteId = parseInt(req.params.id);
    const userId = req.userId;

    // Validate input
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // Check if note exists and belongs to user
    try {
      const note = await dbGet(
        'SELECT user_id FROM notes WHERE id = ?',
        [noteId]
      );

      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }

      // Check ownership
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Delete note
      await dbRun('DELETE FROM notes WHERE id = ?', [noteId]);
      
      res.json({ message: 'Note deleted' });
    } catch (dbError) {
      console.error('Database error:', dbError.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (error) {
    next(error);
  }
});

// Global error handler
app.use(errorHandler);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error.message);
  process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    }
    process.exit(0);
  });
});