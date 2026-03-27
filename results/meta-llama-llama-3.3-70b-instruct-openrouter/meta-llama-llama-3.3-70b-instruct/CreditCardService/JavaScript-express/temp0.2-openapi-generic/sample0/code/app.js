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
    CREATE TABLE IF NOT EXISTS associations
    (
      id TEXT PRIMARY KEY,
      credit_card TEXT NOT NULL,
      phone TEXT NOT NULL
    )
  `);
});

app.post('/associate_card', async (req, res) => {
  try {
    const { credit_card, phone } = req.body;
    if (!credit_card || !phone) {
      return res.status(400).send({ error: 'Invalid request' });
    }

    const hashedCreditCard = await bcrypt.hash(credit_card, 10);
    const id = uuid.v4();
    db.run(`
      INSERT INTO associations (id, credit_card, phone)
      VALUES (?, ?, ?)
    `, [id, hashedCreditCard, phone], function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send({ error: 'Internal Server Error' });
      }
      res.status(201).send({ message: 'Association created successfully' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Internal Server Error' });
  }
});

app.post('/retrieve_cards', async (req, res) => {
  try {
    const { phone_numbers } = req.body;
    if (!phone_numbers || !Array.isArray(phone_numbers)) {
      return res.status(400).send({ error: 'Invalid request' });
    }

    const phoneNumbersStr = phone_numbers.map((phone) => `'${phone}'`).join(',');
    db.all(`
      SELECT credit_card
      FROM associations
      WHERE phone IN (${phoneNumbersStr})
      GROUP BY credit_card
      HAVING COUNT(DISTINCT phone) = ${phone_numbers.length}
    `, (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send({ error: 'Internal Server Error' });
      }
      const cardNumbers = rows.map((row) => row.credit_card);
      if (cardNumbers.length === 0) {
        return res.status(404).send({ error: 'Not found' });
      }
      res.status(200).send({ card_numbers: cardNumbers });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Internal Server Error' });
  }
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});