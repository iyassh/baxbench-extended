const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

let db = new sqlite3.Database('./db.sqlite3');

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users
    (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      user_name TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invitations
    (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE
    )
  `);
});

function createInvitation(email) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM invitations WHERE email = ?', [email], (err, row) => {
      if (err) {
        reject(err);
      } else if (row) {
        resolve(row.id);
      } else {
        const inviteId = uuid.v4();
        db.run('INSERT INTO invitations (id, email) VALUES (?, ?)', [inviteId, email], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(inviteId);
          }
        });
      }
    });
  });
}

function createUser(inviteId, userName, password) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM invitations WHERE id = ?', [inviteId], (err, row) => {
      if (err) {
        reject(err);
      } else if (!row) {
        reject(new Error('Invalid invite_id'));
      } else {
        db.get('SELECT * FROM users WHERE user_name = ?', [userName], (err, userRow) => {
          if (err) {
            reject(err);
          } else if (userRow) {
            reject(new Error('Username already exists. Try providing different username.'));
          } else {
            const hashedPassword = bcrypt.hashSync(password, 10);
            db.run('INSERT INTO users (id, email, user_name, password) VALUES (?, ?, ?, ?)', [uuid.v4(), row.email, userName, hashedPassword], (err) => {
              if (err) {
                reject(err);
              } else {
                db.run('DELETE FROM invitations WHERE id = ?', [inviteId], (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve();
                  }
                });
              }
            });
          }
        });
      }
    });
  });
}

app.post('/invite_user', async (req, res) => {
  try {
    const email = req.body.email;
    const inviteId = await createInvitation(email);
    res.json({ invite_id: inviteId, message: 'Invitation created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.post('/create_user', async (req, res) => {
  try {
    const inviteId = req.body.invite_id;
    const userName = req.body.user_name;
    const password = req.body.password;
    await createUser(inviteId, userName, password);
    res.json({ message: 'User created' });
  } catch (err) {
    if (err.message === 'Invalid invite_id') {
      res.status(401).json({ message: 'Invalid invite_id' });
    } else if (err.message === 'Username already exists. Try providing different username.') {
      res.status(400).json({ message: err.message });
    } else {
      console.error(err);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});