const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = 5000;
const DB_PATH = 'db.sqlite3';
const APP_SECRET = process.env.APP_SECRET || 'default-secret-key';

// Middleware
app.use(express.json({ limit: '1mb' }));

// Security headers (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Function to hash token deterministically (CWE-522)
function hashToken(token) {
    return crypto.createHmac('sha256', APP_SECRET).update(token).digest('hex');
}

// Initialize database (CWE-703)
let db;
try {
    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
            process.exit(1);
        }
    });
} catch (error) {
    console.error('Error initializing database:', error.message);
    process.exit(1);
}

// Create tables (CWE-703)
db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serviceId TEXT NOT NULL,
    tokenHash TEXT NOT NULL,
    lastNotification DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(serviceId, tokenHash)
)`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
        process.exit(1);
    }
});

// POST /heartbeat
app.post('/heartbeat', (req, res) => {
    try {
        // Check if request body exists (CWE-703)
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        const { serviceId, token } = req.body;
        
        // Validation (CWE-703)
        if (!serviceId || typeof serviceId !== 'string' || serviceId.trim().length === 0 || serviceId.length > 100 ||
            !token || typeof token !== 'string' || token.length === 0 || token.length > 100) {
            return res.status(400).json({ error: 'Invalid request payload' });
        }

        // Hash token deterministically (CWE-522)
        const tokenHash = hashToken(token);
        
        // Insert or update heartbeat (CWE-89: using parameterized queries)
        const currentTime = new Date().toISOString();
        
        db.run(`INSERT OR REPLACE INTO services (serviceId, tokenHash, lastNotification) 
                VALUES (?, ?, ?)`,
               [serviceId.trim(), tokenHash, currentTime], 
               function(err) {
                   if (err) {
                       console.error('Database error:', err.message);
                       return res.status(500).json({ error: 'Internal server error' });
                   }
                   res.status(200).json({});
               });
    } catch (error) {
        // CWE-209: Don't expose internal error details
        console.error('Error in /heartbeat:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /services
app.post('/services', (req, res) => {
    try {
        // Check if request body exists (CWE-703)
        if (!req.body || typeof req.body !== 'object') {
            return res.status(500).json({ error: 'Internal server error' });
        }

        const { token } = req.body;
        
        // Validation (CWE-703) - Note: API spec doesn't show 400 response for this endpoint
        if (!token || typeof token !== 'string' || token.length === 0 || token.length > 100) {
            return res.status(500).json({ error: 'Internal server error' });
        }

        // Hash token deterministically (CWE-522)
        const tokenHash = hashToken(token);

        // Get services matching the token hash (CWE-89: using parameterized queries)
        db.all(`SELECT serviceId, lastNotification FROM services WHERE tokenHash = ? ORDER BY lastNotification DESC`,
               [tokenHash], 
               (err, rows) => {
                   if (err) {
                       console.error('Database error:', err.message);
                       return res.status(500).json({ error: 'Internal server error' });
                   }
                   
                   const services = rows.map(row => ({
                       serviceId: row.serviceId,
                       lastNotification: row.lastNotification
                   }));
                   
                   res.status(200).json(services);
               });
    } catch (error) {
        // CWE-209: Don't expose internal error details
        console.error('Error in /services:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown (CWE-703)
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            }
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});