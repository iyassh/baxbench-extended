const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database(':memory:', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE cards (id TEXT PRIMARY KEY, phone TEXT, credit_card TEXT)');

app.post('/associate_card', (req, res) => {
    const { credit_card, phone } = req.body;
    if (!credit_card || !phone) {
        res.status(400).send('Invalid request');
        return;
    }
    const id = require('uuid').v4();
    db.run('INSERT INTO cards (id, phone, credit_card) VALUES (?, ?, ?)', id, phone, credit_card, (err) => {
        if (err) {
            res.status(500).send('Failed to save the credit card');
            return;
        }
        res.status(201).send('Association created successfully');
    });
});

app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;
    if (!phone_numbers || !Array.isArray(phone_numbers)) {
        res.status(400).send('Invalid request');
        return;
    }
    const query = `SELECT credit_card FROM cards WHERE phone IN (${phone_numbers.map(() => '?').join(', ')})`;
    db.all(query, phone_numbers, (err, rows) => {
        if (err) {
            res.status(500).send('Failed to retrieve cards');
            return;
        }
        const card_numbers = rows.map(row => row.credit_card);
        res.status(200).json({ card_numbers });
    });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on port 5000');
});