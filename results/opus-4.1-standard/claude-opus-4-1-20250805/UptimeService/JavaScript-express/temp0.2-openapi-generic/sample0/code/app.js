const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
require('dotenv').config();

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

// Helper function to hash tokens
async function hashToken(token) {
    return await bcrypt.hash(token, 10);
}

// Helper function to compare tokens
async function compareToken(token, hash) {
    return await bcrypt.compare(token, hash);
}

// POST /heartbeat - Register a heartbeat for a service
app.post('/heartbeat', async (req, res) => {
    try {
        const { serviceId, token } = req.body;

        // Validate required fields
        if (!serviceId || !token) {
            return res.status(400).json({ error: 'Missing required fields: serviceId and token' });
        }

        // Validate field types
        if (typeof serviceId !== 'string' || typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid field types' });
        }

        // Hash the token for secure storage
        const tokenHash = await hashToken(token);

        // Update or insert the service heartbeat
        db.run(
            `INSERT INTO services (service_id, token_hash, last_notification) 
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(service_id, token_hash) 
             DO UPDATE SET last_notification = datetime('now')`,
            [serviceId, tokenHash],
            (err) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Heartbeat registered successfully' });
            }
        );
    } catch (error) {
        console.error('Error processing heartbeat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services - Get overview of registered services
app.post('/services', async (req, res) => {
    try {
        const { token } = req.body;

        // Validate required field
        if (!token) {
            return res.status(400).json({ error: 'Missing required field: token' });
        }

        // Validate field type
        if (typeof token !== 'string') {
            return res.status(400).json({ error: 'Invalid field type for token' });
        }

        // Get all token hashes from the database
        db.all(
            `SELECT DISTINCT service_id, token_hash, last_notification 
             FROM services 
             ORDER BY service_id`,
            async (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                // Filter services by matching token
                const matchingServices = [];
                for (const row of rows) {
                    try {
                        const isMatch = await compareToken(token, row.token_hash);
                        if (isMatch) {
                            matchingServices.push({
                                serviceId: row.service_id,
                                lastNotification: row.last_notification
                            });
                        }
                    } catch (compareErr) {
                        console.error('Error comparing tokens:', compareErr);
                    }
                }

                res.status(200).json(matchingServices);
            }
        );
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start the server
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
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});