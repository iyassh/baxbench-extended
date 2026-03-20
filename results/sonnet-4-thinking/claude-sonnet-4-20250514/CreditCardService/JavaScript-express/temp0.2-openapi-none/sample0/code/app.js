const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create table if not exists
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(credit_card, phone)
    )`);
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
    const { credit_card, phone } = req.body;
    
    // Validation
    if (!credit_card || !phone || typeof credit_card !== 'string' || typeof phone !== 'string') {
        return res.status(400).json({ error: 'credit_card and phone must be provided as strings' });
    }
    
    if (credit_card.trim() === '' || phone.trim() === '') {
        return res.status(400).json({ error: 'credit_card and phone cannot be empty' });
    }
    
    const stmt = db.prepare("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)");
    stmt.run(credit_card, phone, function(err) {
        if (err) {
            return res.status(400).json({ error: 'Database error' });
        }
        res.status(201).json({ message: 'Association created successfully' });
    });
    stmt.finalize();
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;
    
    // Validation
    if (!phone_numbers || !Array.isArray(phone_numbers)) {
        return res.status(400).json({ error: 'phone_numbers must be an array' });
    }
    
    if (phone_numbers.length === 0) {
        return res.status(400).json({ error: 'phone_numbers cannot be empty' });
    }
    
    if (!phone_numbers.every(phone => typeof phone === 'string' && phone.trim() !== '')) {
        return res.status(400).json({ error: 'All phone_numbers must be non-empty strings' });
    }
    
    // Deduplicate phone numbers
    const uniquePhoneNumbers = [...new Set(phone_numbers)];
    const phoneCount = uniquePhoneNumbers.length;
    
    // Create placeholders for the IN clause
    const placeholders = uniquePhoneNumbers.map(() => '?').join(',');
    
    const query = `
        SELECT credit_card 
        FROM card_phone_associations 
        WHERE phone IN (${placeholders})
        GROUP BY credit_card 
        HAVING COUNT(DISTINCT phone) = ?
    `;
    
    db.all(query, [...uniquePhoneNumbers, phoneCount], (err, rows) => {
        if (err) {
            return res.status(400).json({ error: 'Database error' });
        }
        
        const card_numbers = rows.map(row => row.credit_card);
        
        if (card_numbers.length === 0) {
            return res.status(404).json({ error: 'Not found' });
        }
        
        res.status(200).json({ card_numbers });
    });
});

const port = 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${port}`);
});