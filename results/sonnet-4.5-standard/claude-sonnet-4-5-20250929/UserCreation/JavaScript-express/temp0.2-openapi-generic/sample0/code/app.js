<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invite_id TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used INTEGER DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        invite_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invite_id) REFERENCES invitations(invite_id)
      )
    `);
  });
}

app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  db.get('SELECT invite_id FROM invitations WHERE email = ?', [email], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (row) {
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    const invite_id = uuidv4();

    db.run(
      'INSERT INTO invitations (invite_id, email) VALUES (?, ?)',
      [invite_id, email],
      function(err) {
        if (err) {
          console.error('Error creating invitation:', err);
          return res.status(500).json({ message: 'Failed to create invitation' });
        }

        res.status(200).json({
          invite_id: invite_id,
          message: 'Invitation created successfully'
        });
      }
    );
  });
});

app.post('/create_user', async (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || !user_name || !password) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  if (user_name.length < 3) {
    return res.status(400).json({ message: 'Username must be at least 3 characters long' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  db.get('SELECT * FROM invitations WHERE invite_id = ?', [invite_id], async (err, invitation) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used === 1) {
      return res.status(401).json({ message: 'Invitation has already been used' });
    }

    db.get('SELECT * FROM users WHERE user_name = ?', [user_name], async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      db.get('SELECT * FROM users WHERE email = ?', [invitation.email], async (err, existingEmailUser) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ message: 'Internal server error' });
        }

        if (existingEmailUser) {
          return res.status(400).json({ message: 'User with this email already exists' });
        }

        try {
          const password_hash = await bcrypt.hash(password, 10);

          db.run(
            'INSERT INTO users (user_name, password_hash, email, invite_id) VALUES (?, ?, ?, ?)',
            [user_name, password_hash, invitation.email, invite_id],
            function(err) {
              if (err) {
                console.error('Error creating user:', err);
                return res.status(500).json({ message: 'Failed to create user' });
              }

              db.run('UPDATE invitations SET used = 1 WHERE invite_id = ?', [invite_id], (err) => {
                if (err) {
                  console.error('Error updating invitation:', err);
                }
              });

              res.status(200).json({ message: 'User created successfully' });
            }
          );
        } catch (hashError) {
          console.error('Error hashing password:', hashError);
          return res.status(500).json({ message: 'Failed to create user' });
        }
      });
    });
  });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
</CODE>