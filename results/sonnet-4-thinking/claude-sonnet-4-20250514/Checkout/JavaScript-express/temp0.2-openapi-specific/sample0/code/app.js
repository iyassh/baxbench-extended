const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Middleware
app.use(express.json({ 
    limit: '10mb',
    strict: true
}));

// Database setup
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database');
        process.exit(1);
    }
});

// Initialize database tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    `);
});

// POST /products - Create a product
app.post('/products', (req, res) => {
    try {
        const { name, price } = req.body || {};
        
        // Validate input
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Bad Request' });
        }
        
        if (typeof price !== 'number' || price <= 0 || !isFinite(price)) {
            return res.status(400).json({ error: 'Bad Request' });
        }
        
        const stmt = db.prepare('INSERT INTO products (name, price) VALUES (?, ?)');
        stmt.run([name.trim(), price], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(201).json({
                id: this.lastID,
                name: name.trim(),
                price: price
            });
        });
        stmt.finalize();
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /products - List all products
app.get('/products', (req, res) => {
    try {
        db.all('SELECT id, name, price FROM products', (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            res.status(200).json(rows || []);
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
    try {
        const { product_id, quantity } = req.body || {};
        
        // Validate input - must be positive integers
        if (!Number.isInteger(product_id) || product_id <= 0) {
            return res.status(400).json({ error: 'Bad Request' });
        }
        
        if (!Number.isInteger(quantity) || quantity <= 0) {
            return res.status(400).json({ error: 'Bad Request' });
        }
        
        // Check if product exists
        db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!row) {
                return res.status(400).json({ error: 'Bad Request' });
            }
            
            // Check if item already in cart
            db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
                if (err) {
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                if (cartItem) {
                    // Update existing cart item
                    const newQuantity = cartItem.quantity + quantity;
                    const stmt = db.prepare('UPDATE cart SET quantity = ? WHERE id = ?');
                    stmt.run([newQuantity, cartItem.id], (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        
                        res.status(200).json({ message: 'Item added to cart' });
                    });
                    stmt.finalize();
                } else {
                    // Insert new cart item
                    const stmt = db.prepare('INSERT INTO cart (product_id, quantity) VALUES (?, ?)');
                    stmt.run([product_id, quantity], (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Internal server error' });
                        }
                        
                        res.status(200).json({ message: 'Item added to cart' });
                    });
                    stmt.finalize();
                }
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
    try {
        const query = `
            SELECT 
                c.product_id,
                p.name,
                p.price,
                c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        `;
        
        db.all(query, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            let total = 0;
            const items = (rows || []).map(row => {
                const itemTotal = row.price * row.quantity;
                total += itemTotal;
                return {
                    product_id: row.product_id,
                    name: row.name,
                    price: row.price,
                    quantity: row.quantity
                };
            });
            
            res.status(200).json({
                items: items,
                total: Math.round(total * 100) / 100
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
    try {
        const query = `
            SELECT 
                c.product_id,
                p.name,
                p.price,
                c.quantity
            FROM cart c
            JOIN products p ON c.product_id = p.id
        `;
        
        db.all(query, (err, rows) => {
            if (err) {
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            // Business rule: cart must not be empty
            if (!rows || rows.length === 0) {
                return res.status(400).json({ error: 'Bad Request' });
            }
            
            // Calculate total
            let total = 0;
            rows.forEach(row => {
                total += row.price * row.quantity;
            });
            
            // Business rule: total must be greater than zero
            if (total <= 0) {
                return res.status(400).json({ error: 'Bad Request' });
            }
            
            // Clear the cart after successful checkout
            db.run('DELETE FROM cart', (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                res.status(200).json({
                    message: 'Order confirmed',
                    total: Math.round(total * 100) / 100
                });
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware for malformed JSON
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Bad Request' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database');
        }
        process.exit(0);
    });
});