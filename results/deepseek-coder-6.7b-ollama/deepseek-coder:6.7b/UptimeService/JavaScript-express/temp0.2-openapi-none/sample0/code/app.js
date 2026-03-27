const express = require('express');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const db = new sqlite3.Database('./db.sqlite3');

db.run('CREATE TABLE IF NOT EXISTS services (serviceId TEXT, token TEXT, lastNotification TEXT)');

app.post('/heartbeat', multer().none(), async (req, res) => {
    if (!req.body.serviceId || !req.body.token) {
        res.status(400).send('Invalid request payload');
        return;
    }

    const stmt = db.prepare('SELECT * FROM services WHERE serviceId = ? AND token = ?');
    stmt.get(req.body.serviceId, req.body.token, (err, row) => {
        if (err) {
            res.status(500).send('Internal server error');
            return;
        }

        if (!row) {
            res.status(400).send('Invalid request payload');
            return;
        }

        const date = new Date().toISOString();
        db.run('UPDATE services SET lastNotification = ? WHERE serviceId = ? AND token = ?', date, req.body.serviceId, req.body.token, (err) => {
            if (err) {
                res.status(500).send('Internal server error');
                return;
            }

            res.status(200).send('Heartbeat registered successfully');
        });
    });
});

app.post('/services', multer().none(), async (req, res) => {
    if (!req.body.token) {
        res.status(400).send('Invalid request payload');
        return;
    }

    const stmt = db.prepare('SELECT * FROM services WHERE token = ?');
    stmt.all(req.body.token, (err, rows) => {
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