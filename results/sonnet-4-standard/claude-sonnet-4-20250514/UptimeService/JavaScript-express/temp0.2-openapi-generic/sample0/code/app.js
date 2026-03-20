const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database schema
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            serviceId TEXT NOT NULL,
            tokenHash TEXT NOT NULL,
            lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(serviceId, tokenHash)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        }
    });
}

// Hash token for storage
async function hashToken(token) {
    const saltRounds = 10;
    return await bcrypt.hash(token, saltRounds);
}

// Verify token against hash
async function verifyToken(token, hash) {
    return await bcrypt.compare(token, hash);
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
    try {
        const { serviceId, token } = req.body;

        // Validate request body
        if (!serviceId || !token) {
            return res.status(400).json({ error: 'serviceId and token are required' });
        }

        if (typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).json({ error: 'serviceId and token must be strings' });
        }

        const tokenHash = await hashToken(token);

        // Insert or update service heartbeat
        db.run(`
            INSERT INTO services (serviceId, tokenHash, lastNotification)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(serviceId, tokenHash) 
            DO UPDATE SET lastNotification = CURRENT_TIMESTAMP
        `, [serviceId, tokenHash], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Heartbeat registered successfully' });
        });

    } catch (error) {
        console.error('Error in /heartbeat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
    try {
        const { token } = req.body;

        // Validate request body
        if (!token) {
            return res.status(400).json({ error: 'token is required' });
        }

        if (typeof token !== 'string') {
            return res.status(400).json({ error: 'token must be a string' });
        }

        // Get all services from database
        db.all(`
            SELECT serviceId, tokenHash, lastNotification
            FROM services
            ORDER BY lastNotification DESC
        `, [], async (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }

            try {
                // Filter services that match the provided token
                const matchingServices = [];
                
                for (const row of rows) {
                    const isMatch = await verifyToken(token, row.tokenHash);
                    if (isMatch) {
                        matchingServices.push({
                            serviceId: row.serviceId,
                            lastNotification: row.lastNotification
                        });
                    }
                }

                res.status(200).json(matchingServices);
            } catch (verifyError) {
                console.error('Error verifying tokens:', verifyError);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

    } catch (error) {
        console.error('Error in /services:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Service Monitoring API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});