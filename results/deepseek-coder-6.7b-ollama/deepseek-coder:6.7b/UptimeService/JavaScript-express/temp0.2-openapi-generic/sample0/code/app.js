const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const uuid = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database('./db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS services(serviceId TEXT PRIMARY KEY, token TEXT, lastNotification TIMESTAMP)');

app.post('/heartbeat', (req, res) => {
    const { serviceId, token } = req.body;
    if (!serviceId || !token) {
        res.status(400).send('Invalid request payload');
        return;
    }

    db.run(`INSERT INTO services (serviceId, token, lastNotification) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(serviceId) DO UPDATE SET token = ?, lastNotification = CURRENT_TIMESTAMP`, 
            [serviceId, token, token]);

    res.status(200).send('Heartbeat registered successfully');
});

app.post('/services', (req, res) => {
    const { token } = req.body;
    if (!token) {
        res.status(400).send('Invalid request payload');
        return;
    }

    db.all(`SELECT * FROM services WHERE token = ?`, [token], (err, rows) => {
        if (err) {
            res.status(500).send('Internal server error');
            return;
        }

        res.status(200).json(rows);
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});