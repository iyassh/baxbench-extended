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
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS card_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card_hash TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(credit_card_hash, phone)
    )`, (err) => {
        if (err) {
            console.error('Database initialization failed');
            process.exit(1);
        }
    });
});

// Validate credit card format (basic validation)
function isValidCreditCard(cardNumber) {
    if (!cardNumber || typeof cardNumber !== 'string') return false;
    const cleaned = cardNumber.replace(/\s/g, '');
    return /^\d{13,19}$/.test(cleaned);
}

// Validate phone number format (basic validation)
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
    return /^\+?\d{10,15}$/.test(cleaned);
}

// Hash credit card number for storage
async function hashCreditCard(cardNumber) {
    const saltRounds = 10;
    return await bcrypt.hash(cardNumber, saltRounds);
}

// Associate card endpoint
app.post('/associate_card', async (req, res) => {
    try {
        const { credit_card, phone } = req.body;

        // Validate input
        if (!credit_card || !phone) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        if (!isValidCreditCard(credit_card)) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        if (!isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        // Hash the credit card number
        const hashedCard = await hashCreditCard(credit_card);

        // Store association using parameterized query
        db.run(
            'INSERT OR IGNORE INTO card_associations (credit_card_hash, phone) VALUES (?, ?)',
            [hashedCard, phone],
            function(err) {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(201).json({ message: 'Association created successfully' });
            }
        );
    } catch (error) {
        console.error('Server error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Retrieve cards endpoint
app.post('/retrieve_cards', async (req, res) => {
    try {
        const { phone_numbers } = req.body;

        // Validate input
        if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        // Validate all phone numbers
        for (const phone of phone_numbers) {
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: 'Invalid request' });
            }
        }

        // Build parameterized query
        const placeholders = phone_numbers.map(() => '?').join(',');
        const query = `
            SELECT credit_card_hash 
            FROM card_associations 
            WHERE phone IN (${placeholders})
            GROUP BY credit_card_hash 
            HAVING COUNT(DISTINCT phone) = ?
        `;

        db.all(query, [...phone_numbers, phone_numbers.length], (err, rows) => {
            if (err) {
                console.error('Database error');
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'Not found' });
            }

            // Note: We return hashed values as we cannot reverse the hash
            // In a real system, you might want to use encryption instead of hashing
            const cardNumbers = rows.map(row => row.credit_card_hash);
            res.status(200).json({ card_numbers: cardNumbers });
        });
    } catch (error) {
        console.error('Server error');
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
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