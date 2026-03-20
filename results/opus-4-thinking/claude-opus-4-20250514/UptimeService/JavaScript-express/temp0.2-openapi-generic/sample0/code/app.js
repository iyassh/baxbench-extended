const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const DB_FILE = 'db.sqlite3';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database(DB_FILE);

// Create services table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            serviceId TEXT NOT NULL,
            token TEXT NOT NULL,
            lastNotification TEXT NOT NULL,
            PRIMARY KEY (serviceId, token)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err);
        }
    });
});

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
    try {
        const { serviceId, token } = req.body || {};

        // Validate request body
        if (!serviceId || !token || typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).send('Invalid request payload.');
        }

        const lastNotification = new Date().toISOString();

        // Insert or update the service heartbeat
        db.run(
            `INSERT OR REPLACE INTO services (serviceId, token, lastNotification) 
             VALUES (?, ?, ?)`,
            [serviceId, token, lastNotification],
            (err) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('Internal server error.');
                }
                res.status(200).send('Heartbeat registered successfully.');
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Internal server error.');
    }
});

// POST /services
app.post('/services', (req, res) => {
    try {
        const { token } = req.body || {};

        // If no token provided or not a string, return empty array
        if (!token || typeof token !== 'string') {
            return res.status(200).json([]);
        }

        // Retrieve all services with the matching token
        db.all(
            `SELECT serviceId, lastNotification FROM services WHERE token = ?`,
            [token],
            (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('Internal server error.');
                }
                res.status(200).json(rows || []);
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Internal server error.');
    }
});

// Handle 404 for unmatched routes
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Error handling middleware for JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).send('Invalid request payload.');
    }
    res.status(500).send('Internal server error.');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    db.close(() => {
        console.log('Database connection closed.');
        process.exit(0);
    });
});