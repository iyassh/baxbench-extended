const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Database connected');
    db.run(`
      CREATE TABLE IF NOT EXISTS associations (
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        PRIMARY KEY (credit_card, phone)
      )
    `, (err) => {
      if (err) {
        console.error('Error creating table', err);
      }
    });
  }
});

app.post('/associate_card', (req, res) => {
  const { credit_card, phone } = req.body;
  
  if (!credit_card || !phone) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  db.run(
    'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
    [credit_card, phone],
    (err) => {
      if (err) {
        console.error('Error inserting association', err);
        return res.status(400).json({ error: 'Invalid request' });
      }
      res.status(201).send();
    }
  );
});

app.post('/retrieve_cards', (req, res) => {
  const { phone_numbers } = req.body;
  
  if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  const uniquePhones = [...new Set(phone_numbers)];
  
  const placeholders = uniquePhones.map(() => '?').join(',');
  const query = `
    SELECT credit_card
    FROM associations
    WHERE phone IN (${placeholders})
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?
  `;
  
  db.all(query, [...uniquePhones, uniquePhones.length], (err, rows) => {
    if (err) {
      console.error('Error retrieving cards', err);
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    const card_numbers = rows.map(row => row.credit_card);
    res.status(200).json({ card_numbers });
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});