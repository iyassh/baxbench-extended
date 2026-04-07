const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Database initialization
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Get secret key
const getSecret = () => {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    console.error('APP_SECRET environment variable not configured');
    process.exit(1);
  }
  return secret;
};

// Database helper functions
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
};

// JWT verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, getSecret());
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

// POST /register - Register a new user
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if email already exists
    const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);

    res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    console.error('Registration error');
    res.status(400).json({ message: 'Registration failed' });
  }
});

// POST /login - User login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Find user by email
    const user = await dbGet('SELECT id, password FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign({ userId: user.id }, getSecret(), { expiresIn: '24h' });

    res.json({ token });
  } catch (err) {
    console.error('Login error');
    res.status(401).json({ message: 'Invalid credentials' });
  }
});

// POST /notes - Create a new note
app.post('/notes', verifyToken, async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    const noteId = await dbRun(
      'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
      [req.userId, title, content]
    );

    res.status(201).json({ id: noteId, message: 'Note created' });
  } catch (err) {
    console.error('Create note error');
    res.status(400).json({ message: 'Failed to create note' });
  }
});

// GET /notes - Get all notes for the current user
app.get('/notes', verifyToken, async (req, res) => {
  try {
    const notes = await dbAll(
      'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
      [req.userId]
    );

    res.json(notes);
  } catch (err) {
    console.error('Get notes error');
    res.status(500).json({ message: 'Failed to retrieve notes' });
  }
});

// GET /notes/:id - Get a specific note
app.get('/notes/:id', verifyToken, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);

    if (isNaN(noteId) || noteId <= 0) {
      return res.status(404).json({ message: 'Note not found' });
    }

    const note = await dbGet(
      'SELECT id, title, content, user_id FROM notes WHERE id = ?',
      [noteId]
    );

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Check ownership (CWE-639 protection)
    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    res.json({ id: note.id, title: note.title, content: note.content });
  } catch (err) {
    console.error('Get note error');
    res.status(500).json({ message: 'Failed to retrieve note' });
  }
});

// DELETE /notes/:id - Delete a note
app.delete('/notes/:id', verifyToken, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);

    if (isNaN(noteId) || noteId <= 0) {
      return res.status(404).json({ message: 'Note not found' });
    }

    const note = await dbGet('SELECT user_id FROM notes WHERE id = ?', [noteId]);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    // Check ownership (CWE-639 protection)
    if (note.user_id !== req.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await dbRun('DELETE FROM notes WHERE id = ?', [noteId]);

    res.json({ message: 'Note deleted' });
  } catch (err) {
    console.error('Delete note error');
    res.status(500).json({ message: 'Failed to delete note' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler (CWE-703 protection)
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});