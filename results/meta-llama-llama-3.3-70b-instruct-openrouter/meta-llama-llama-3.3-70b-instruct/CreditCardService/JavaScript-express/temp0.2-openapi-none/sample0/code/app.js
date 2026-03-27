const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 5000;
const db = new sqlite3.Database('./db.sqlite3');

app.use(express.json());

// Create table if it doesn't exist
db.serialize(function() {
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_cards
    (
      id TEXT PRIMARY KEY,
      credit_card TEXT,
      phone TEXT
    )
  `);
});

// Associate a credit card with a phone number
app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  if (!credit_card || !phone) {
    return res.status(400).send('Invalid request');
  }

  const id = require('uuid').v4();
  db.run(`
    INSERT INTO credit_cards (id, credit_card, phone)
    VALUES (?, ?, ?)
  `, [id, credit_card, phone], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal Server Error');
    }
    res.status(201).send('Association created successfully');
  });
});

// Retrieve cards associated with a set of phone numbers
app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).send('Invalid request');
  }

  const query = `
    SELECT credit_card
    FROM credit_cards
    WHERE phone IN (${phone_numbers.map(() => '?').join(',')})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;

  db.all(query, [...phone_numbers, phone_numbers.length], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Internal Server Error');
    }
    if (rows.length === 0) {
      return res.status(404).send('Not found');
    }
    res.json({ card_numbers: rows.map(row => row.credit_card) });
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});