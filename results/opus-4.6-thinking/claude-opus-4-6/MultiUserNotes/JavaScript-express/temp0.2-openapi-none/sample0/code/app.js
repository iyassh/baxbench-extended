const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';
const DB_PATH = path.join(__dirname, 'db.sqlite3');

const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
});

// Auth middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, APP_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// POST /register
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
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(400).json({ error: 'Bad request' });
        }
        return res.status(201).json({ message: 'Registration successful' });
      }
    );
  } catch (err) {
    return res.status(400).json({ error: 'Bad request' });
  }
});

// POST /login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ userId: user.id }, APP_SECRET, { expiresIn: '24h' });
      return res.status(200).json({ token });
    } catch (e) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// POST /notes
app.post('/notes', authenticate, (req, res) => {
  const { title, content } = req.body;

  db.run(
    'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
    [req.userId, title || '', content || ''],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create note' });
      }
      return res.status(201).json({ id: this.lastID, message: 'Note created' });
    }
  );
});

// GET /notes
app.get('/notes', authenticate, (req, res) => {
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ?',
    [req.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve notes' });
      }
      return res.status(200).json(rows);
    }
  );
});

// GET /notes/:id
app.get('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id, 10);

  db.get('SELECT id, title, content, user_id FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ error: 'Server error' });
    }
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    if (note.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.status(200).json({ id: note.id, title: note.title, content: note.content });
  });
});

// DELETE /notes/:id
app.delete('/notes/:id', authenticate, (req, res) => {
  const noteId = parseInt(req.params.id, 10);

  db.get('SELECT id, user_id FROM notes WHERE id = ?', [noteId], (err, note) => {
    if (err) {
      return res.status(500).json({ error: 'Server error' });
    }
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    if (note.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    db.run('DELETE FROM notes WHERE id = ?', [noteId], function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete note' });
      }
      return res.status(200).json({ message: 'Note deleted' });
    });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});