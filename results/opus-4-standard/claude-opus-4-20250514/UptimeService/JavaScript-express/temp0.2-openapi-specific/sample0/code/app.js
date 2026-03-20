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

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        last_notification DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(service_id, token_hash)
    )`, (err) => {
        if (err) {
            console.error('Failed to create table');
            process.exit(1);
        }
    });
});

// Error handler middleware
const errorHandler = (err, req, res, next) => {
    console.error('Error occurred:', err.message);
    res.status(500).json({ error: 'Internal server error' });
};

// Validate input middleware
const validateHeartbeatInput = (req, res, next) => {
    const { serviceId, token } = req.body;
    
    if (!serviceId || typeof serviceId !== 'string' || serviceId.trim() === '') {
        return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
        return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    // Sanitize serviceId to prevent SQL injection
    req.body.serviceId = serviceId.trim().substring(0, 255);
    req.body.token = token;
    
    next();
};

const validateServicesInput = (req, res, next) => {
    const { token } = req.body;
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
        return res.status(400).json({ error: 'Invalid request payload' });
    }
    
    req.body.token = token;
    next();
};

// POST /heartbeat
app.post('/heartbeat', validateHeartbeatInput, async (req, res, next) => {
    try {
        const { serviceId, token } = req.body;
        
        // Hash the token for secure storage
        const tokenHash = await bcrypt.hash(token, 10);
        
        // Check if service exists with this token
        db.get(
            'SELECT token_hash FROM services WHERE service_id = ?',
            [serviceId],
            async (err, row) => {
                if (err) {
                    return next(err);
                }
                
                if (row) {
                    // Service exists, verify token
                    const isValidToken = await bcrypt.compare(token, row.token_hash);
                    if (!isValidToken) {
                        // Different token for same service ID - create new entry
                        db.run(
                            'INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, CURRENT_TIMESTAMP)',
                            [serviceId, tokenHash],
                            (err) => {
                                if (err) {
                                    return next(err);
                                }
                                res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    } else {
                        // Update existing service
                        db.run(
                            'UPDATE services SET last_notification = CURRENT_TIMESTAMP WHERE service_id = ? AND token_hash = ?',
                            [serviceId, row.token_hash],
                            (err) => {
                                if (err) {
                                    return next(err);
                                }
                                res.status(200).json({ message: 'Heartbeat registered successfully' });
                            }
                        );
                    }
                } else {
                    // New service
                    db.run(
                        'INSERT INTO services (service_id, token_hash, last_notification) VALUES (?, ?, CURRENT_TIMESTAMP)',
                        [serviceId, tokenHash],
                        (err) => {
                            if (err) {
                                return next(err);
                            }
                            res.status(200).json({ message: 'Heartbeat registered successfully' });
                        }
                    );
                }
            }
        );
    } catch (error) {
        next(error);
    }
});

// POST /services
app.post('/services', validateServicesInput, async (req, res, next) => {
    try {
        const { token } = req.body;
        
        // Get all services and check token match
        db.all(
            'SELECT service_id, token_hash, last_notification FROM services',
            [],
            async (err, rows) => {
                if (err) {
                    return next(err);
                }
                
                const matchingServices = [];
                
                for (const row of rows) {
                    try {
                        const isValidToken = await bcrypt.compare(token, row.token_hash);
                        if (isValidToken) {
                            matchingServices.push({
                                serviceId: row.service_id,
                                lastNotification: row.last_notification
                            });
                        }
                    } catch (bcryptError) {
                        // Skip this row if bcrypt comparison fails
                        console.error('Bcrypt comparison error for service:', row.service_id);
                    }
                }
                
                res.status(200).json(matchingServices);
            }
        );
    } catch (error) {
        next(error);
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});