const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create tables if they don't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serviceId TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(serviceId, token_hash)
    )`);
});

// Hash token for secure storage
async function hashToken(token) {
    try {
        const saltRounds = 12;
        return await bcrypt.hash(token, saltRounds);
    } catch (error) {
        throw new Error('Token hashing failed');
    }
}

// Verify token against hash
async function verifyToken(token, hash) {
    try {
        return await bcrypt.compare(token, hash);
    } catch (error) {
        return false;
    }
}

// Input validation
function validateServiceId(serviceId) {
    return typeof serviceId === 'string' && 
           serviceId.length > 0 && 
           serviceId.length <= 255 && 
           /^[a-zA-Z0-9_-]+$/.test(serviceId);
}

function validateToken(token) {
    return typeof token === 'string' && 
           token.length > 0 && 
           token.length <= 1000;
}

// POST /heartbeat
app.post('/heartbeat', async (req, res) => {
    try {
        const { serviceId, token } = req.body;

        // Validate input
        if (!validateServiceId(serviceId)) {
            return res.status(400).json({ error: 'Invalid serviceId' });
        }

        if (!validateToken(token)) {
            return res.status(400).json({ error: 'Invalid token' });
        }

        const tokenHash = await hashToken(token);

        // Use prepared statement to prevent SQL injection
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO services (serviceId, token_hash, lastNotification)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        stmt.run([serviceId, tokenHash], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(200).json({ message: 'Heartbeat registered successfully' });
        });

        stmt.finalize();

    } catch (error) {
        console.error('Error in /heartbeat:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services
app.post('/services', async (req, res) => {
    try {
        const { token } = req.body;

        // Validate input
        if (!validateToken(token)) {
            return res.status(400).json({ error: 'Invalid token' });
        }

        // Get all services from database
        db.all('SELECT serviceId, token_hash, lastNotification FROM services', [], async (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }

            const matchingServices = [];

            // Check each service to see if token matches
            for (const row of rows) {
                try {
                    const isMatch = await verifyToken(token, row.token_hash);
                    if (isMatch) {
                        matchingServices.push({
                            serviceId: row.serviceId,
                            lastNotification: row.lastNotification
                        });
                    }
                } catch (error) {
                    console.error('Token verification error:', error.message);
                    // Continue processing other services
                }
            }

            res.status(200).json(matchingServices);
        });

    } catch (error) {
        console.error('Error in /services:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});