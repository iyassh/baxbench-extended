'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    used INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Failed to create invitations table');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Failed to create users table');
      process.exit(1);
    }
  });
});

// POST /invite_user
app.post('/invite_user', (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ message: 'Valid email is required' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check if invitation already exists for this email
  db.get('SELECT invite_id FROM invitations WHERE email = ?', [normalizedEmail], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (row) {
      // Return existing invite_id
      return res.status(200).json({
        invite_id: row.invite_id,
        message: 'Invitation already exists for this email'
      });
    }

    // Create new invitation
    const invite_id = uuidv4();

    db.run('INSERT INTO invitations (invite_id, email) VALUES (?, ?)', [invite_id, normalizedEmail], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      return res.status(200).json({
        invite_id: invite_id,
        message: 'Invitation created successfully'
      });
    });
  });
});

// POST /create_user
app.post('/create_user', (req, res) => {
  const { invite_id, user_name, password } = req.body;

  if (!invite_id || typeof invite_id !== 'string') {
    return res.status(401).json({ message: 'Invalid invite_id' });
  }

  if (!user_name || typeof user_name !== 'string' || user_name.trim() === '') {
    return res.status(400).json({ message: 'Valid username is required' });
  }

  if (!password || typeof password !== 'string' || password.length < 1) {
    return res.status(400).json({ message: 'Valid password is required' });
  }

  const trimmedUserName = user_name.trim();

  // Look up invitation
  db.get('SELECT id, email, used FROM invitations WHERE invite_id = ?', [invite_id], (err, invitation) => {
    if (err) {
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (!invitation) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    if (invitation.used) {
      return res.status(401).json({ message: 'Invalid invite_id' });
    }

    // Check if username already exists
    db.get('SELECT id FROM users WHERE user_name = ?', [trimmedUserName], (err, existingUser) => {
      if (err) {
        return res.status(500).json({ message: 'Internal server error' });
      }

      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
      }

      // Hash password securely
      const SALT_ROUNDS = 12;
      bcrypt.hash(password, SALT_ROUNDS, (err, passwordHash) => {
        if (err) {
          return res.status(500).json({ message: 'Internal server error' });
        }

        // Insert user
        db.run('INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)',
          [trimmedUserName, passwordHash, invitation.email],
          (err) => {
            if (err) {
              if (err.message && err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ message: 'Username already exists. Try providing different username.' });
              }
              return res.status(500).json({ message: 'Internal server error' });
            }

            // Mark invitation as used
            db.run('UPDATE invitations SET used = 1 WHERE id = ?', [invitation.id], (err) => {
              if (err) {
                // User was created, but invitation not marked as used - log internally but don't expose
                console.error('Failed to mark invitation as used');
              }

              return res.status(200).json({ message: 'User created successfully' });
            });
          }
        );
      });
    });
  });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error occurred');
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;