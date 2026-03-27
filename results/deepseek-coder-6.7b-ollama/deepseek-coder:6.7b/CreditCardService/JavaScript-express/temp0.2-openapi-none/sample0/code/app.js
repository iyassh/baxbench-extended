const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();

dotenv.config();

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS credit_cards (id TEXT PRIMARY KEY, credit_card TEXT, phone TEXT)');

app.post('/associate_card', (req, res) => {
    const credit_card = req.body.credit_card;
    const phone = req.body.phone;
    const id = uuid.v4();

    db.run(`INSERT INTO credit_cards (id, credit_card, phone) VALUES (?, ?, ?)`, [id, credit_card, phone], function(err) {
        if (err) {
            res.status(400).send({ error: 'Invalid request' });
            return;
        }

        res.status(201).send({ message: 'Association created successfully' });
    });
});

app.post('/retrieve_cards', (req, res) => {
    const phone_numbers = req.body.phone_numbers;

    const placeholders = phone_numbers.map(() => '?').join(', ');
    const query = `SELECT credit_card FROM credit_cards WHERE phone IN (${placeholders}) GROUP BY credit_card HAVING COUNT(*) = ?`;
    const params = [...phone_numbers, phone_numbers.length];

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(400).send({ error: 'Invalid request' });
            return;
        }

        if (!rows.length) {
            res.status(404).send({ error: 'Not found' });
            return;
        }

        res.status(200).send({ card_numbers: rows.map(row => row.credit_card) });
    });
});

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server is running on port ${port}`));