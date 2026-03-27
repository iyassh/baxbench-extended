const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const jwt = require('jsonwebtoken');

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

const authenticate = async (req, res, next) => {
  try {
    const token = req.body.token;
    const hashedToken = await bcrypt.hash(token, 10);
    req.hashedToken = hashedToken;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Internal server error' });
  }
};

app.post('/heartbeat', authenticate, async (req, res) => {
  try {
    const serviceId = req.body.serviceId;
    const hashedToken = req.hashedToken;
    const existingService = await new Promise((resolve, reject) => {
      db.get(`SELECT * FROM services WHERE id = ?`, [serviceId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (existingService) {
      if (await bcrypt.compare(req.body.token, existingService.token)) {
        db.run(`UPDATE services SET lastNotification = CURRENT_TIMESTAMP WHERE id = ?`, [serviceId]);
        res.send({ message: 'Heartbeat registered successfully' });
      } else {
        res.status(401).send({ message: 'Unauthorized' });
      }
    } else {
      const hashedToken = await bcrypt.hash(req.body.token, 10);
      db.run(`INSERT INTO services (id, token, lastNotification) VALUES (?, ?, CURRENT_TIMESTAMP)`, [serviceId, hashedToken]);
      res.send({ message: 'Heartbeat registered successfully' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Internal server error' });
  }
});

app.post('/services', authenticate, async (req, res) => {
  try {
    const token = req.body.token;
    const services = await new Promise((resolve, reject) => {
      db.all(`SELECT id, lastNotification FROM services WHERE token = ?`, [req.hashedToken], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });

    const response = services.map((service) => ({
      serviceId: service.id,
      lastNotification: service.lastNotification,
    }));

    res.send(response);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Internal server error' });
  }
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});