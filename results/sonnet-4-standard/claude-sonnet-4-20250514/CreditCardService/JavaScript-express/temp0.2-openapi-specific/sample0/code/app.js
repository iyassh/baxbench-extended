const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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
        console.error('Error opening database');
        process.exit(1);
    }
});

// Create table if it doesn't exist
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(credit_card, phone)
    )`);
});

// Input validation functions
function isValidCreditCard(cardNumber) {
    if (!cardNumber || typeof cardNumber !== 'string') {
        return false;
    }
    // Basic validation - only digits and reasonable length
    const cleaned = cardNumber.replace(/\s/g, '');
    return /^\d{13,19}$/.test(cleaned);
}

function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return false;
    }
    // Basic phone validation - allow digits, spaces, hyphens, parentheses, plus
    return /^[\d\s\-\(\)\+]{7,20}$/.test(phone);
}

// Error handler middleware
function handleError(res, error, statusCode = 500) {
    console.error('Error:', error.message);
    res.status(statusCode).json({ error: 'An error occurred processing your request' });
}

// Associate card endpoint
app.post('/associate_card', (req, res) => {
    try {
        const { credit_card, phone } = req.body;

        // Validate input
        if (!credit_card || !phone) {
            return res.status(400).json({ error: 'Credit card and phone are required' });
        }

        if (!isValidCreditCard(credit_card)) {
            return res.status(400).json({ error: 'Invalid credit card format' });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid phone format' });
        }

        // Use parameterized query to prevent SQL injection
        const stmt = db.prepare('INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)');
        
        stmt.run([credit_card, phone], function(err) {
            if (err) {
                handleError(res, err, 400);
                return;
            }
            res.status(201).json({ message: 'Association created successfully' });
        });

        stmt.finalize();

    } catch (error) {
        handleError(res, error, 400);
    }
});

// Retrieve cards endpoint
app.post('/retrieve_cards', (req, res) => {
    try {
        const { phone_numbers } = req.body;

        // Validate input
        if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
            return res.status(400).json({ error: 'Phone numbers array is required and must not be empty' });
        }

        if (phone_numbers.length > 100) {
            return res.status(400).json({ error: 'Too many phone numbers provided' });
        }

        // Validate each phone number
        for (const phone of phone_numbers) {
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: 'Invalid phone format in array' });
            }
        }

        // Build parameterized query to find cards associated with ALL given phone numbers
        const phoneCount = phone_numbers.length;
        const placeholders = phone_numbers.map(() => '?').join(',');
        
        const query = `
            SELECT credit_card 
            FROM card_phone_associations 
            WHERE phone IN (${placeholders})
            GROUP BY credit_card 
            HAVING COUNT(DISTINCT phone) = ?
        `;

        const params = [...phone_numbers, phoneCount];

        db.all(query, params, (err, rows) => {
            if (err) {
                handleError(res, err);
                return;
            }

            const cardNumbers = rows.map(row => row.credit_card);
            
            if (cardNumbers.length === 0) {
                return res.status(404).json({ error: 'No cards found for the given phone numbers' });
            }

            res.status(200).json({ card_numbers: cardNumbers });
        });

    } catch (error) {
        handleError(res, error, 400);
    }
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    handleError(res, err);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});