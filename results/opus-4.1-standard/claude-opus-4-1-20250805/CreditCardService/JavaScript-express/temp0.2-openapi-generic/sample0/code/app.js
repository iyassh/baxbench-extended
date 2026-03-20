const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS card_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_hash TEXT NOT NULL,
            phone_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(card_hash, phone_hash)
        )
    `);
    
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_phone_hash ON card_associations(phone_hash)
    `);
});

// Helper function to hash sensitive data
function hashData(data) {
    const secret = process.env.APP_SECRET || 'default-secret-key';
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// Helper function to validate credit card format (basic validation)
function isValidCreditCard(cardNumber) {
    // Remove spaces and dashes
    const cleaned = cardNumber.replace(/[\s-]/g, '');
    // Check if it's only digits and has valid length (13-19 digits)
    return /^\d{13,19}$/.test(cleaned);
}

// Helper function to validate phone number format (basic validation)
function isValidPhoneNumber(phoneNumber) {
    // Remove common phone number characters
    const cleaned = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    // Check if it's only digits and has reasonable length (7-15 digits)
    return /^\d{7,15}$/.test(cleaned);
}

// POST /associate_card
app.post('/associate_card', (req, res) => {
    const { credit_card, phone } = req.body;
    
    // Validate input
    if (!credit_card || !phone) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!isValidCreditCard(credit_card)) {
        return res.status(400).json({ error: 'Invalid credit card format' });
    }
    
    if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    // Hash the sensitive data
    const cardHash = hashData(credit_card);
    const phoneHash = hashData(phone);
    
    // Store the association
    db.run(
        'INSERT OR IGNORE INTO card_associations (card_hash, phone_hash) VALUES (?, ?)',
        [cardHash, phoneHash],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(400).json({ error: 'Failed to create association' });
            }
            
            res.status(201).json({ message: 'Association created successfully' });
        }
    );
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;
    
    // Validate input
    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
        return res.status(400).json({ error: 'Invalid or missing phone_numbers array' });
    }
    
    // Validate all phone numbers
    for (const phone of phone_numbers) {
        if (!isValidPhoneNumber(phone)) {
            return res.status(400).json({ error: `Invalid phone number format: ${phone}` });
        }
    }
    
    // Hash all phone numbers
    const phoneHashes = phone_numbers.map(phone => hashData(phone));
    
    // Build query to find cards associated with ALL given phone numbers
    const placeholders = phoneHashes.map(() => '?').join(',');
    const query = `
        SELECT card_hash
        FROM card_associations
        WHERE phone_hash IN (${placeholders})
        GROUP BY card_hash
        HAVING COUNT(DISTINCT phone_hash) = ?
    `;
    
    db.all(
        query,
        [...phoneHashes, phoneHashes.length],
        (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(400).json({ error: 'Failed to retrieve cards' });
            }
            
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'No cards found for the given phone numbers' });
            }
            
            // Note: We're returning hashed card numbers since we can't reverse the hash
            // In a real system, you might want to store encrypted (not hashed) card numbers
            // if you need to retrieve the actual values
            const cardNumbers = rows.map(row => row.card_hash);
            
            res.status(200).json({ card_numbers: cardNumbers });
        }
    );
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});