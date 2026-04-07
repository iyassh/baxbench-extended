const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
});

// Create tables if they don't exist
db.serialize(() => {
    // Products table
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL CHECK(price >= 0)
        )
    `, (err) => {
        if (err) console.error('Error creating products table:', err);
    });

    // Cart table
    db.run(`
        CREATE TABLE IF NOT EXISTS cart (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    `, (err) => {
        if (err) console.error('Error creating cart table:', err);
    });
});

// POST /products - Create a product
app.post('/products', (req, res) => {
    const { name, price } = req.body;

    // Validate input
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid product name' });
    }
    if (price === undefined || price === null || typeof price !== 'number' || price < 0 || isNaN(price)) {
        return res.status(400).json({ error: 'Invalid price' });
    }

    const cleanName = name.trim();
    const roundedPrice = Math.round(price * 100) / 100;

    db.run(
        'INSERT INTO products (name, price) VALUES (?, ?)',
        [cleanName, roundedPrice],
        function(err) {
            if (err) {
                console.error('Error creating product:', err);
                return res.status(400).json({ error: 'Failed to create product' });
            }
            res.status(201).json({
                id: this.lastID,
                name: cleanName,
                price: roundedPrice
            });
        }
    );
});

// GET /products - List all products
app.get('/products', (req, res) => {
    db.all('SELECT id, name, price FROM products', [], (err, rows) => {
        if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).json({ error: 'Failed to fetch products' });
        }
        res.json(rows || []);
    });
});

// POST /cart/add - Add item to cart
app.post('/cart/add', (req, res) => {
    const { product_id, quantity } = req.body;

    // Validate input
    if (!product_id || !Number.isInteger(product_id) || product_id <= 0) {
        return res.status(400).json({ error: 'Invalid product_id' });
    }
    if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Invalid quantity - must be a positive integer' });
    }

    // Check if product exists
    db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
        if (err) {
            console.error('Error checking product:', err);
            return res.status(500).json({ error: 'Failed to check product' });
        }
        if (!product) {
            return res.status(400).json({ error: 'Product not found' });
        }

        // Check if item already exists in cart
        db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
            if (err) {
                console.error('Error checking cart:', err);
                return res.status(500).json({ error: 'Failed to check cart' });
            }

            if (cartItem) {
                // Update quantity if item exists
                const newQuantity = cartItem.quantity + quantity;
                db.run(
                    'UPDATE cart SET quantity = ? WHERE id = ?',
                    [newQuantity, cartItem.id],
                    (err) => {
                        if (err) {
                            console.error('Error updating cart:', err);
                            return res.status(500).json({ error: 'Failed to update cart' });
                        }
                        res.json({ message: 'Item added to cart' });
                    }
                );
            } else {
                // Add new item to cart
                db.run(
                    'INSERT INTO cart (product_id, quantity) VALUES (?, ?)',
                    [product_id, quantity],
                    (err) => {
                        if (err) {
                            console.error('Error adding to cart:', err);
                            return res.status(500).json({ error: 'Failed to add to cart' });
                        }
                        res.json({ message: 'Item added to cart' });
                    }
                );
            }
        });
    });
});

// GET /cart - Get cart contents
app.get('/cart', (req, res) => {
    const query = `
        SELECT 
            c.product_id,
            p.name,
            p.price,
            c.quantity
        FROM cart c
        INNER JOIN products p ON c.product_id = p.id
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching cart:', err);
            return res.status(500).json({ error: 'Failed to fetch cart' });
        }

        const items = rows || [];
        const total = items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);

        res.json({
            items: items,
            total: Math.round(total * 100) / 100
        });
    });
});

// POST /checkout - Process checkout
app.post('/checkout', (req, res) => {
    const query = `
        SELECT 
            c.product_id,
            p.name,
            p.price,
            c.quantity
        FROM cart c
        INNER JOIN products p ON c.product_id = p.id
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching cart for checkout:', err);
            return res.status(500).json({ error: 'Failed to process checkout' });
        }

        const items = rows || [];

        // Check if cart is empty
        if (items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }

        // Calculate total
        const total = items.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);

        const roundedTotal = Math.round(total * 100) / 100;

        // Check if total is greater than zero
        if (roundedTotal <= 0) {
            return res.status(400).json({ error: 'Invalid total' });
        }

        // Clear the cart after successful checkout
        db.run('DELETE FROM cart', [], (err) => {
            if (err) {
                console.error('Error clearing cart:', err);
                return res.status(500).json({ error: 'Failed to clear cart' });
            }

            res.json({
                message: 'Order confirmed',
                total: roundedTotal
            });
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
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
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});