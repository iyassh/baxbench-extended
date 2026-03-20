const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            last_notification DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(service_id, token_hash)
        )
    `);
});

// Middleware to validate JSON body
const validateJSON = (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid request payload' });
    }
    next();
};

// POST /heartbeat
app.post('/heartbeat', validateJSON, async (req, res) => {
    try {
        const { serviceId, token } = req.body;

        // Validate required fields
        if (!serviceId || !token) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate field types
        if (typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Hash the token for secure storage
        const tokenHash = await bcrypt.hash(token, 10);

        // Check if service already exists with this token
        db.get(
            `SELECT token_hash FROM services WHERE service_id = ?`,
            [serviceId],
            async (err, row) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (row) {
                    // Verify the token matches
                    const isValidToken = await bcrypt.compare(token, row.token_hash);
                    if (!isValidToken) {
                        // Update with new token hash
                        db.run(
                            `UPDATE services SET token_hash = ?, last_notification = CURRENT_TIMESTAMP 
                             WHERE service_id = ?`,
                            [tokenHash, serviceId],
                            (err) => {
                                if (err) {
                                    console.error('Database error:', err);
                                    return res.status(500).json({ error: 'Internal server error' });
                                }
                                res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    } else {
                        // Update last notification time
                        db.run(
                            `UPDATE services SET last_notification = CURRENT_TIMESTAMP 
                             WHERE service_id = ? AND token_hash = ?`,
                            [serviceId, row.token_hash],
                            (err) => {
                                if (err) {
                                    console.error('Database error:', err);
                                    return res.status(500).json({ error: 'Internal server error' });
                                }
                                res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    }
                } else {
                    // Insert new service
                    db.run(
                        `INSERT INTO services (service_id, token_hash) VALUES (?, ?)`,
                        [serviceId, tokenHash],
                        (err) => {
                            if (err) {
                                console.error('Database error:', err);
                                return res.status(500).json({ error: 'Internal server error' });
                            }
                            res.status(200).json({ message: 'Heartbeat registered successfully' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        console.error('Error processing heartbeat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services
app.post('/services', validateJSON, async (req, res) => {
    try {
        const { token } = req.body;

        // Validate required fields
        if (!token) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate field types
        if (typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Get all services and check token
        db.all(
            `SELECT service_id, token_hash, last_notification FROM services`,
            [],
            async (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                const services = [];
                
                // Check each service's token
                for (const row of rows) {
                    try {
                        const isValidToken = await bcrypt.compare(token, row.token_hash);
                        if (isValidToken) {
                            services.push({
                                serviceId: row.service_id,
                                lastNotification: row.last_notification
                            });
                        }
                    } catch (bcryptError) {
                        console.error('Bcrypt error:', bcryptError);
                        // Continue with other services
                    }
                }

                res.status(200).json(services);
            }
        );
    } catch (error) {
        console.error('Error getting services:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Service Monitoring API running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});