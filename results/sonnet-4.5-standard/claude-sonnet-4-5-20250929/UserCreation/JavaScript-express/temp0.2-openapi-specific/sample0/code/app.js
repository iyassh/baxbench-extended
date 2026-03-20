<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Validate email format
function isValidEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validate username
function isValidUsername(username) {
  if (!username || typeof username !== 'string') {
    return false;
  }
  return username.length >= 3 && username.length <= 50;
}

// Validate password
function isValidPassword(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }
  return password.length >= 8;
}

// POST /invite_user
app.post('/invite_user', async (req, res) => {
  try {
    const { email } = req.body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if email already has an invitation
    db.get('SELECT id FROM invitations WHERE email = ?', [email], (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (row) {
        // Return existing invite_id
        return res.status(200).json({
          invite_id: row.id,
          message: 'Invitation already exists for this email'
        });
      }

      // Create new invitation
      const invite_id = uuidv4();
      db.run('INSERT INTO invitations (id, email) VALUES (?, ?)', [invite_id, email], (err) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }

        return res.status(200).json({
          invite_id: invite_id,
          message: 'Invitation created successfully'
        });
      });
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /create_user
app.post('/create_user', async (req, res) => {
  try {
    const { invite_id, user_name, password } = req.body;

    if (!invite_id || typeof invite_id !== 'string') {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (!isValidUsername(user_name)) {
      return res.status(400).json({ message: 'Invalid username. Must be between 3 and 50 characters' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ message: 'Invalid password. Must be at least 8 characters' });
    }

    // Check if invitation exists and is not used
    db.get('SELECT id, email, used FROM invitations WHERE id = ?', [invite_id], async (err, invitation) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (!invitation) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      if (invitation.used === 1) {
        return res.status(401).json({ message: 'Invalid invite_id' });
      }

      // Check if username already exists
      db.get('SELECT id FROM users WHERE username = ?', [user_name], async (err, existingUser) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (existingUser) {
          return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
        }

        // Check if email already has a user
        db.get('SELECT id FROM users WHERE email = ?', [invitation.email], async (err, existingEmail) => {
          if (err) {
            return res.status(500).json({ message: 'Internal server error' });
          }

          if (existingEmail) {
            return res.status(400).json({ message: 'User with this email already exists' });
          }

          try {
            // Hash password
            const password_hash = await bcrypt.hash(password, 10);

            // Create user
            db.run('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
              [user_name, password_hash, invitation.email],
              function(err) {
                if (err) {
                  return res.status(500).json({ message: 'Internal server error' });
                }

                // Mark invitation as used
                db.run('UPDATE invitations SET used = 1 WHERE id = ?', [invite_id], (err) => {
                  if (err) {
                    return res.status(500).json({ message: 'Internal server error' });
                  }

                  return res.status(200).json({ message: 'User created successfully' });
                });
              }
            );
          } catch (error) {
            return res.status(500).json({ message: 'Internal server error' });
          }
        });
      });
    });
  } catch (error) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json({ message: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
</CODE>