const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create tables if they don't exist
function initializeDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(credit_card, phone)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Database table initialized');
        }
    });
}

// Input validation functions
function isValidCreditCard(cardNumber) {
    if (!cardNumber || typeof cardNumber !== 'string') return false;
    // Remove spaces and check if it's all digits
    const cleaned = cardNumber.replace(/\s/g, '');
    return /^\d{13,19}$/.test(cleaned);
}

function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    // Basic phone validation - allow digits, spaces, dashes, parentheses, plus
    return /^[\d\s\-\(\)\+]{7,20}$/.test(phone);
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
    try {
        const { credit_card, phone } = req.body;

        // Validate input
        if (!credit_card || !phone) {
            return res.status(400).json({ error: 'Both credit_card and phone are required' });
        }

        if (!isValidCreditCard(credit_card)) {
            return res.status(400).json({ error: 'Invalid credit card format' });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        // Clean credit card number (remove spaces)
        const cleanedCard = credit_card.replace(/\s/g, '');

        // Insert association into database
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) 
            VALUES (?, ?)
        `);

        stmt.run([cleanedCard, phone], function(err) {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(400).json({ error: 'Failed to create association' });
            }

            res.status(201).json({ message: 'Association created successfully' });
        });

        stmt.finalize();

    } catch (error) {
        console.error('Error in associate_card:', error);
        res.status(400).json({ error: 'Invalid request' });
    }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    try {
        const { phone_numbers } = req.body;

        // Validate input
        if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
            return res.status(400).json({ error: 'phone_numbers array is required and must not be empty' });
        }

        // Validate each phone number
        for (const phone of phone_numbers) {
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: 'Invalid phone number format in array' });
            }
        }

        // Create placeholders for SQL query
        const placeholders = phone_numbers.map(() => '?').join(',');
        
        // Query to find cards associated with ALL given phone numbers
        const query = `
            SELECT credit_card 
            FROM card_phone_associations 
            WHERE phone IN (${placeholders})
            GROUP BY credit_card 
            HAVING COUNT(DISTINCT phone) = ?
        `;

        const params = [...phone_numbers, phone_numbers.length];

        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(400).json({ error: 'Database query failed' });
            }

            const cardNumbers = rows.map(row => row.credit_card);

            if (cardNumbers.length === 0) {
                return res.status(404).json({ error: 'No cards found for the given phone numbers' });
            }

            res.status(200).json({ card_numbers: cardNumbers });
        });

    } catch (error) {
        console.error('Error in retrieve_cards:', error);
        res.status(400).json({ error: 'Invalid request' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});