const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Failed to connect to database');
        process.exit(1);
    }
});

// Create table if not exists
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS heartbeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            last_notification DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(service_id, token_hash)
        )
    `, (err) => {
        if (err) {
            console.error('Failed to create table');
            process.exit(1);
        }
    });
});

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
    try {
        const { serviceId, token } = req.body;

        // Validate required fields
        if (!serviceId || !token) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate input types
        if (typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate input lengths
        if (serviceId.length === 0 || serviceId.length > 255 || token.length === 0 || token.length > 255) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Hash the token for secure storage
        const tokenHash = await bcrypt.hash(token, 10);

        // Check if service already exists with this token
        db.get(
            `SELECT token_hash FROM heartbeats WHERE service_id = ?`,
            [serviceId],
            async (err, row) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (row) {
                    // Service exists, verify token
                    const isValidToken = await bcrypt.compare(token, row.token_hash);
                    if (!isValidToken) {
                        // Update with new token hash
                        db.run(
                            `UPDATE heartbeats SET token_hash = ?, last_notification = CURRENT_TIMESTAMP WHERE service_id = ?`,
                            [tokenHash, serviceId],
                            (err) => {
                                if (err) {
                                    console.error('Database error');
                                    return res.status(500).json({ error: 'Internal server error' });
                                }
                                return res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    } else {
                        // Update last notification time
                        db.run(
                            `UPDATE heartbeats SET last_notification = CURRENT_TIMESTAMP WHERE service_id = ?`,
                            [serviceId],
                            (err) => {
                                if (err) {
                                    console.error('Database error');
                                    return res.status(500).json({ error: 'Internal server error' });
                                }
                                return res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    }
                } else {
                    // Insert new service
                    db.run(
                        `INSERT INTO heartbeats (service_id, token_hash) VALUES (?, ?)`,
                        [serviceId, tokenHash],
                        (err) => {
                            if (err) {
                                console.error('Database error');
                                return res.status(500).json({ error: 'Internal server error' });
                            }
                            return res.status(200).json({ message: 'Heartbeat registered successfully' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        console.error('Server error');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services
app.post('/services', async (req, res) => {
    try {
        const { token } = req.body;

        // Validate required fields
        if (!token) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate input type
        if (typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Validate input length
        if (token.length === 0 || token.length > 255) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Get all services and check token match
        db.all(
            `SELECT service_id, token_hash, last_notification FROM heartbeats`,
            [],
            async (err, rows) => {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }

                const services = [];
                for (const row of rows) {
                    try {
                        const isValidToken = await bcrypt.compare(token, row.token_hash);
                        if (isValidToken) {
                            services.push({
                                serviceId: row.service_id,
                                lastNotification: row.last_notification
                            });
                        }
                    } catch (compareError) {
                        console.error('Token comparison error');
                        // Continue with other services
                    }
                }

                return res.status(200).json(services);
            }
        );
    } catch (error) {
        console.error('Server error');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});