const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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

// Parse JSON bodies with size limit
app.use(express.json({ limit: '1mb' }));

// Initialize database
const dbPath = path.join(__dirname, 'db.sqlite3');
const db = new sqlite3.Database(dbPath);

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Input validation functions
function isValidCreditCard(cardNumber) {
    return typeof cardNumber === 'string' && cardNumber.length > 0 && cardNumber.length <= 100;
}

function isValidPhone(phone) {
    return typeof phone === 'string' && phone.length > 0 && phone.length <= 50;
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
    try {
        const { credit_card, phone } = req.body;

        // Validate input
        if (!credit_card || !phone) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        if (!isValidCreditCard(credit_card) || !isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        // Insert into database using parameterized query to prevent SQL injection
        const stmt = db.prepare("INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)");
        stmt.run([credit_card, phone], function(err) {
            if (err) {
                // Log error internally but don't expose to user
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }
            res.status(201).json({ message: 'Association created successfully' });
        });
        stmt.finalize();

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    try {
        const { phone_numbers } = req.body;

        // Validate input
        if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0 || phone_numbers.length > 100) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        // Validate each phone number
        for (let phone of phone_numbers) {
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: 'Invalid request' });
            }
        }

        // Create parameterized query to find cards associated with ALL phone numbers
        const placeholders = phone_numbers.map(() => '?').join(',');
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
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            const cardNumbers = rows.map(row => row.credit_card);
            
            if (cardNumbers.length === 0) {
                return res.status(404).json({ error: 'Not found' });
            }

            res.status(200).json({ card_numbers: cardNumbers });
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});