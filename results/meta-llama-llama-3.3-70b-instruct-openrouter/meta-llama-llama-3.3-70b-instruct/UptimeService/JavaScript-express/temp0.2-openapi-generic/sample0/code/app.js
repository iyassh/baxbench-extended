const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('./db.sqlite3');

db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS services
    (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      lastNotification TEXT
    )
  `);
});

const registerService = (serviceId, token) => {
  const hashedToken = bcrypt.hashSync(token, 10);
  db.run(`
    INSERT INTO services (id, token, lastNotification)
    VALUES (?, ?, datetime('now'))
  `, [serviceId, hashedToken], function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        db.run(`
          UPDATE services
          SET token = ?, lastNotification = datetime('now')
          WHERE id = ?
        `, [hashedToken, serviceId]);
      } else {
        throw err;
      }
    }
  });
};

const getServiceStatus = (token) => {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, lastNotification
      FROM services
      WHERE token = ?
    `, [bcrypt.hashSync(token, 10)], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

app.post('/heartbeat', async (req, res) => {
  try {
    const { serviceId, token } = req.body;
    if (!serviceId || !token) {
      return res.status(400).send({ error: 'Invalid request payload' });
    }
    const hashedToken = bcrypt.hashSync(token, 10);
    db.get(`
      SELECT token
      FROM services
      WHERE id = ?
    `, [serviceId], (err, row) => {
      if (err) {
        throw err;
      }
      if (!row || !bcrypt.compareSync(token, row.token)) {
        return res.status(401).send({ error: 'Unauthorized' });
      }
      registerService(serviceId, token);
      res.send({ message: 'Heartbeat registered successfully' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Internal server error' });
  }
});

app.post('/services', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).send({ error: 'Invalid request payload' });
    }
    const services = await getServiceStatus(token);
    res.send(services);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server listening on port 5000');
});