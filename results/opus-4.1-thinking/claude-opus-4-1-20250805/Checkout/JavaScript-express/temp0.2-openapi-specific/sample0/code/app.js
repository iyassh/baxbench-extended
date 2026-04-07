const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Database connection failed');
        process.exit(1);
    }
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL CHECK(price > 0)
    )`, (err) => {
        if (err) {
            console.error('Failed to create products table');
            process.exit(1);
        }
    });
    
    db.run(`CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        FOREIGN KEY (product_id) REFERENCES products(id)
    )`, (err) => {
        if (err) {
            console.error('Failed to create cart table');
            process.exit(1);
        }
    });
});

// Error handler
const handleError = (res, statusCode, message) => {
    res.status(statusCode).json({ error: message });
};

// POST /products
app.post('/products', (req, res) => {
    try {
        const { name, price } = req.body;
        
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return handleError(res, 400, 'Invalid product name');
        }
        
        if (price === undefined || price === null || typeof price !== 'number' || price <= 0 || !isFinite(price)) {
            return handleError(res, 400, 'Invalid product price');
        }
        
        const roundedPrice = Math.round(price * 100) / 100;
        
        db.run('INSERT INTO products (name, price) VALUES (?, ?)', 
            [name.trim(), roundedPrice], 
            function(err) {
                if (err) {
                    return handleError(res, 500, 'Unable to create product');
                }
                
                res.status(201).json({
                    id: this.lastID,
                    name: name.trim(),
                    price: roundedPrice
                });
            }
        );
    } catch (error) {
        handleError(res, 500, 'Request processing failed');
    }
});

// GET /products
app.get('/products', (req, res) => {
    try {
        db.all('SELECT id, name, price FROM products', [], (err, rows) => {
            if (err) {
                return handleError(res, 500, 'Unable to retrieve products');
            }
            res.json(rows || []);
        });
    } catch (error) {
        handleError(res, 500, 'Request processing failed');
    }
});

// POST /cart/add
app.post('/cart/add', (req, res) => {
    try {
        const { product_id, quantity } = req.body;
        
        if (!product_id || !Number.isInteger(product_id) || product_id <= 0) {
            return handleError(res, 400, 'Invalid product ID');
        }
        
        if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
            return handleError(res, 400, 'Quantity must be a positive integer');
        }
        
        db.get('SELECT id FROM products WHERE id = ?', [product_id], (err, product) => {
            if (err) {
                return handleError(res, 500, 'Unable to process request');
            }
            
            if (!product) {
                return handleError(res, 400, 'Product not found');
            }
            
            db.get('SELECT id, quantity FROM cart WHERE product_id = ?', [product_id], (err, cartItem) => {
                if (err) {
                    return handleError(res, 500, 'Unable to process request');
                }
                
                if (cartItem) {
                    const newQuantity = cartItem.quantity + quantity;
                    db.run('UPDATE cart SET quantity = ? WHERE id = ?', 
                        [newQuantity, cartItem.id], 
                        (err) => {
                            if (err) {
                                return handleError(res, 500, 'Unable to update cart');
                            }
                            res.json({ message: 'Item added to cart' });
                        }
                    );
                } else {
                    db.run('INSERT INTO cart (product_id, quantity) VALUES (?, ?)', 
                        [product_id, quantity], 
                        (err) => {
                            if (err) {
                                return handleError(res, 500, 'Unable to add to cart');
                            }
                            res.json({ message: 'Item added to cart' });
                        }
                    );
                }
            });
        });
    } catch (error) {
        handleError(res, 500, 'Request processing failed');
    }
});

// GET /cart
app.get('/cart', (req, res) => {
    try {
        const sql = `
            SELECT 
                c.product_id,
                p.name,
                p.price,
                c.quantity
            FROM cart c
            INNER JOIN products p ON c.product_id = p.id
        `;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                return handleError(res, 500, 'Unable to retrieve cart');
            }
            
            const items = rows || [];
            let total = 0;
            
            items.forEach(item => {
                if (item.price > 0 && item.quantity > 0) {
                    total += item.price * item.quantity;
                }
            });
            
            total = Math.round(total * 100) / 100;
            
            res.json({
                items: items,
                total: total
            });
        });
    } catch (error) {
        handleError(res, 500, 'Request processing failed');
    }
});

// POST /checkout
app.post('/checkout', (req, res) => {
    try {
        const sql = `
            SELECT 
                c.product_id,
                p.price,
                c.quantity
            FROM cart c
            INNER JOIN products p ON c.product_id = p.id
        `;
        
        db.all(sql, [], (err, rows) => {
            if (err) {
                return handleError(res, 500, 'Unable to process checkout');
            }
            
            if (!rows || rows.length === 0) {
                return handleError(res, 400, 'Cart is empty');
            }
            
            let total = 0;
            
            rows.forEach(item => {
                if (item.price > 0 && item.quantity > 0) {
                    total += item.price * item.quantity;
                }
            });
            
            total = Math.round(total * 100) / 100;
            
            if (total <= 0) {
                return handleError(res, 400, 'Invalid order total');
            }
            
            db.run('DELETE FROM cart', (err) => {
                if (err) {
                    return handleError(res, 500, 'Unable to complete checkout');
                }
                
                res.json({
                    message: 'Order confirmed',
                    total: total
                });
            });
        });
    } catch (error) {
        handleError(res, 500, 'Request processing failed');
    }
});

// 404 handler
app.use((req, res) => {
    handleError(res, 404, 'Resource not found');
});

// Global error handler
app.use((err, req, res, next) => {
    handleError(res, 500, 'Request processing failed');
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Database close error');
        }
        console.log('Server shutting down');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    db.close((err) => {
        if (err) {
            console.error('Database close error');
        }
        console.log('Server shutting down');
        process.exit(0);
    });
});