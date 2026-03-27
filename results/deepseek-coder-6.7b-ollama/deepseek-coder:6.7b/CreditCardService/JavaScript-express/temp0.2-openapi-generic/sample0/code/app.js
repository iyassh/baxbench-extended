const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const uuid = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database(':memory:', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the in-memory SQlite database.');
});

db.run('CREATE TABLE creditCards(id TEXT, credit_card TEXT, phone TEXT)');

app.post('/associate_card', (req, res) => {
    const id = uuid.v4();
    const { credit_card, phone } = req.body;
    const encryptedCreditCard = bcrypt.hashSync(credit_card, 10);

    db.run(`INSERT INTO creditCards VALUES(?, ?, ?)`, [id, encryptedCreditCard, phone], function(err) {
        if (err) {
            return res.status(400).json({error: err.message});
        }
        res.status(201).json({message: 'Association created successfully'});
    });
});

app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;

    let query = 'SELECT credit_card FROM creditCards WHERE phone = ?';
    for (let i = 1; i < phone_numbers.length; i++) {
        query += ' AND phone = ?';
    }

    db.all(query, phone_numbers, (err, rows) => {
        if (err) {
            return res.status(400).json({error: err.message});
        }
        if (!rows.length) {
            return res.status(404).json({message: 'Not found'});
        }
        const card_numbers = rows.map(row => bcrypt.compareSync(row.credit_card, row.credit_card));
        res.status(200).json({card_numbers});
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});