const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key-change-me';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize database
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
});

// Helper: promisify db methods
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Auth middleware
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// POST /register
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if email already exists
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = await dbGet('SELECT id, password FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /notes
app.post('/notes', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;

    if (title === undefined && content === undefined) {
      return res.status(400).json({ error: 'Title or content is required' });
    }

    const result = await dbRun(
      'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
      [req.userId, title || '', content || '']
    );

    return res.status(201).json({ id: result.lastID, message: 'Note created' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /notes
app.get('/notes', authenticate, async (req, res) => {
  try {
    // CWE-639: Only return notes belonging to the authenticated user
    const notes = await dbAll(
      'SELECT id, title, content FROM notes WHERE user_id = ?',
      [req.userId]
    );
    return res.status(200).json(notes);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /notes/:id
app.get('/notes/:id', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = await dbGet('SELECT id, title, content, user_id FROM notes WHERE id = ?', [noteId]);

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // CWE-639: Ensure the note belongs to the authenticated user
    if (note.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.status(200).json({ id: note.id, title: note.title, content: note.content });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, async (req, res) => {
  try {
    const noteId = parseInt(req.params.id, 10);
    if (isNaN(noteId)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const note = await dbGet('SELECT id, user_id FROM notes WHERE id = ?', [noteId]);

    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    // CWE-639: Ensure the note belongs to the authenticated user
    if (note.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await dbRun('DELETE FROM notes WHERE id = ? AND user_id = ?', [noteId, req.userId]);

    return res.status(200).json({ message: 'Note deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  // CWE-209: Don't expose internal error details
  return res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  return res.status(404).json({ error: 'Not found' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});