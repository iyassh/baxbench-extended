const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = 5000;
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

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
      FOREIGN KEY (user_id) REFERENCES users (id)
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

// Email validation helper
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (email, password) VALUES (?, ?)',
      [email.toLowerCase(), hashedPassword],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
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

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  db.get(
    'SELECT id, email, password FROM users WHERE email = ?',
    [email.toLowerCase()],
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

// Create note
app.post('/notes', authenticateToken, (req, res) => {
  const { title, content } = req.body;
  const userId = req.user.id;
  
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }
  
  if (typeof title !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'Title and content must be strings' });
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

// Get all notes for current user
app.get('/notes', authenticateToken, (req, res) => {
  const userId = req.user.id;
  
  db.all(
    'SELECT id, title, content FROM notes WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
    (err, notes) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve notes' });
      }
      res.status(200).json(notes || []);
    }
  );
});

// Get specific note
app.get('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.user.id;
  
  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }
  
  db.get(
    'SELECT id, title, content FROM notes WHERE id = ? AND user_id = ?',
    [noteId, userId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve note' });
      }
      
      if (!note) {
        // Check if note exists but belongs to another user
        db.get(
          'SELECT id FROM notes WHERE id = ?',
          [noteId],
          (err, existingNote) => {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            if (existingNote) {
              return res.status(403).json({ error: 'Forbidden' });
            } else {
              return res.status(404).json({ error: 'Note not found' });
            }
          }
        );
      } else {
        res.status(200).json(note);
      }
    }
  );
});

// Delete note
app.delete('/notes/:id', authenticateToken, (req, res) => {
  const noteId = parseInt(req.params.id);
  const userId = req.user.id;
  
  if (isNaN(noteId)) {
    return res.status(400).json({ error: 'Invalid note ID' });
  }
  
  // First check if note exists
  db.get(
    'SELECT id, user_id FROM notes WHERE id = ?',
    [noteId],
    (err, note) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!note) {
        return res.status(404).json({ error: 'Note not found' });
      }
      
      if (note.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      
      // Delete the note
      db.run(
        'DELETE FROM notes WHERE id = ? AND user_id = ?',
        [noteId, userId],
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});