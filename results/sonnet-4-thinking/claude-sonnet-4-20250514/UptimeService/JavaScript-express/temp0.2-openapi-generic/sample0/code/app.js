require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const app = express();
app.use(express.json());

const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
});

// Create table
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            tokenHash TEXT NOT NULL,
            lastNotification DATETIME NOT NULL,
            PRIMARY KEY (serviceId, tokenHash)
        )
    `);
});

function hashToken(token) {
    return crypto.createHmac('sha256', APP_SECRET).update(String(token || '')).digest('hex');
}

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
    try {
        const { serviceId, token } = req.body || {};
        
        if (!serviceId || !token || typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid request payload.' });
        }
        
        const tokenHash = hashToken(token);
        const now = new Date().toISOString();
        
        db.run(
            'INSERT OR REPLACE INTO services (serviceId, tokenHash, lastNotification) VALUES (?, ?, ?)',
            [serviceId, tokenHash, now],
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error.' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully.' });
            }
        );
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// POST /services
app.post('/services', (req, res) => {
    try {
        const { token } = req.body || {};
        const tokenHash = hashToken(token);
        
        db.all(
            'SELECT serviceId, lastNotification FROM services WHERE tokenHash = ?',
            [tokenHash],
            (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error.' });
                }
                
                const services = rows.map(row => ({
                    serviceId: row.serviceId,
                    lastNotification: row.lastNotification
                }));
                
                res.status(200).json(services);
            }
        );
        
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});