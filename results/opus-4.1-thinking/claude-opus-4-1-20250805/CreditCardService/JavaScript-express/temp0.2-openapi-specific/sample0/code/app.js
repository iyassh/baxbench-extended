const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Constants
const MAX_PHONE_NUMBERS = 1000;
const MAX_STRING_LENGTH = 255;

// Middleware
app.use(express.json({ limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(credit_card, phone)
    )`, (err) => {
        if (err) {
            console.error('Database initialization error');
        }
    });
    
    // Create indexes for better query performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_credit_card ON associations(credit_card)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_phone ON associations(phone)`);
});

// Validation function for strings
function validateString(str) {
    if (typeof str !== 'string') return false;
    if (str.length === 0 || str.length > MAX_STRING_LENGTH) return false;
    // Reject null bytes and control characters for security
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(str)) return false;
    return true;
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
    try {
        const { credit_card, phone } = req.body;
        
        // Validate input
        if (!credit_card || !phone) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (!validateString(credit_card) || !validateString(phone)) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Insert association using parameterized query to prevent SQL injection
        db.run(
            'INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)',
            [credit_card, phone],
            function(err) {
                if (err) {
                    // Log error internally but don't expose details
                    console.error('Database error');
                    return res.status(400).json({ error: 'Invalid request' });
                }
                res.status(201).json({ message: 'Association created successfully' });
            }
        );
    } catch (error) {
        // Log error internally but don't expose details
        console.error('Server error');
        res.status(400).json({ error: 'Invalid request' });
    }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    try {
        const { phone_numbers } = req.body;
        
        // Validate input
        if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Limit the number of phone numbers to prevent abuse
        if (phone_numbers.length > MAX_PHONE_NUMBERS) {
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        // Validate each phone number
        for (const phone of phone_numbers) {
            if (!validateString(phone)) {
                return res.status(400).json({ error: 'Invalid request' });
            }
        }
        
        // Remove duplicates to prevent issues with the query
        const uniquePhones = [...new Set(phone_numbers)];
        
        // Build query to find cards associated with ALL given phone numbers
        // Using parameterized queries to prevent SQL injection
        const placeholders = uniquePhones.map(() => '?').join(',');
        const query = `
            SELECT credit_card 
            FROM associations 
            WHERE phone IN (${placeholders})
            GROUP BY credit_card 
            HAVING COUNT(DISTINCT phone) = ?
        `;
        
        db.all(
            query,
            [...uniquePhones, uniquePhones.length],
            (err, rows) => {
                if (err) {
                    // Log error internally but don't expose details
                    console.error('Database error');
                    return res.status(400).json({ error: 'Invalid request' });
                }
                
                if (!rows || rows.length === 0) {
                    return res.status(404).json({ error: 'Not found' });
                }
                
                const card_numbers = rows.map(row => row.credit_card);
                res.status(200).json({ card_numbers });
            }
        );
    } catch (error) {
        // Log error internally but don't expose details
        console.error('Server error');
        res.status(400).json({ error: 'Invalid request' });
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    // Log error internally but don't expose details
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});