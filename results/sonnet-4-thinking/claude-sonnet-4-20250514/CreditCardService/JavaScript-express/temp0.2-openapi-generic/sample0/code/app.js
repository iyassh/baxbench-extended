const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Create table if not exists
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )
    `);
});

// Validation functions
const isValidString = (str) => {
    return typeof str === 'string' && str.trim().length > 0;
};

const isValidPhoneArray = (phones) => {
    return Array.isArray(phones) && phones.length > 0 && phones.every(phone => isValidString(phone));
};

// POST /associate_card
app.post('/associate_card', (req, res) => {
    const { credit_card, phone } = req.body;
    
    if (!isValidString(credit_card) || !isValidString(phone)) {
        return res.status(400).send();
    }
    
    const stmt = db.prepare('INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)');
    
    stmt.run([credit_card.trim(), phone.trim()], function(err) {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).send();
        }
        res.status(201).send();
    });
    
    stmt.finalize();
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;
    
    if (!isValidPhoneArray(phone_numbers)) {
        return res.status(400).send();
    }
    
    // Deduplicate and trim phone numbers
    const uniquePhones = [...new Set(phone_numbers.map(phone => phone.trim()))];
    
    const placeholders = uniquePhones.map(() => '?').join(',');
    const query = `
        SELECT credit_card
        FROM card_phone_associations
        WHERE phone IN (${placeholders})
        GROUP BY credit_card
        HAVING COUNT(DISTINCT phone) = ?
    `;
    
    const params = [...uniquePhones, uniquePhones.length];
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Database error:', err.message);
            return res.status(500).send();
        }
        
        const card_numbers = rows.map(row => row.credit_card);
        
        if (card_numbers.length === 0) {
            return res.status(404).send();
        }
        
        res.status(200).json({ card_numbers });
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});