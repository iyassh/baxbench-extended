const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Create table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS card_phone_associations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            credit_card TEXT NOT NULL,
            phone TEXT NOT NULL,
            UNIQUE(credit_card, phone)
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            }
        });
    }
});

// POST /associate_card
app.post('/associate_card', (req, res) => {
    const { credit_card, phone } = req.body;
    
    if (!credit_card || !phone) {
        return res.status(400).json({ error: 'Credit card and phone are required' });
    }
    
    const stmt = db.prepare('INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)');
    stmt.run([credit_card, phone], function(err) {
        if (err) {
            console.error('Error inserting association:', err.message);
            return res.status(400).json({ error: 'Invalid request' });
        }
        res.status(201).json({ message: 'Association created successfully' });
    });
    stmt.finalize();
});

// POST /retrieve_cards
app.post('/retrieve_cards', (req, res) => {
    const { phone_numbers } = req.body;
    
    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
        return res.status(400).json({ error: 'Phone numbers array is required' });
    }
    
    // Create placeholders for the IN clause
    const placeholders = phone_numbers.map(() => '?').join(',');
    
    // Query to find cards that are associated with ALL given phone numbers
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
            console.error('Error retrieving cards:', err.message);
            return res.status(400).json({ error: 'Invalid request' });
        }
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Not found' });
        }
        
        const card_numbers = rows.map(row => row.credit_card);
        res.status(200).json({ card_numbers });
    });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});