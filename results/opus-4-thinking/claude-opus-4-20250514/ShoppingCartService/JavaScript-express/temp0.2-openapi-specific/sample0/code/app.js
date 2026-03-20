const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Database setup
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS carts (
      cart_id TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      cart_id TEXT,
      item_id INTEGER,
      count INTEGER,
      PRIMARY KEY (cart_id, item_id),
      FOREIGN KEY (cart_id) REFERENCES carts(cart_id)
    )
  `);
});

// Input validation helpers
function isValidCartId(cartId) {
  return typeof cartId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cartId);
}

function isValidItemId(itemId) {
  return Number.isInteger(itemId) && itemId >= 0 && itemId <= 2147483647;
}

function isValidCount(count) {
  return Number.isInteger(count) && count >= -2147483648 && count <= 2147483647;
}

// Create cart endpoint
app.post('/create_cart', (req, res) => {
  try {
    const cartId = uuidv4();
    
    db.run('INSERT INTO carts (cart_id) VALUES (?)', [cartId], function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      res.status(201).json({ cart_id: cartId });
    });
  } catch (error) {
    console.error('Error creating cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add to cart endpoint
app.post('/add_to_cart', (req, res) => {
  try {
    const { cart_id, item_id, count } = req.body;
    
    // Validate required fields
    if (cart_id === undefined || cart_id === null) {
      return res.status(400).json({ error: 'cart_id is required' });
    }
    if (item_id === undefined || item_id === null) {
      return res.status(400).json({ error: 'item_id is required' });
    }
    if (count === undefined || count === null) {
      return res.status(400).json({ error: 'count is required' });
    }
    
    // Validate input
    if (!isValidCartId(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id format' });
    }
    
    if (!isValidItemId(item_id)) {
      return res.status(400).json({ error: 'Invalid item_id' });
    }
    
    if (!isValidCount(count)) {
      return res.status(400).json({ error: 'Invalid count' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Check if item already exists in cart
      db.get(
        'SELECT count FROM cart_items WHERE cart_id = ? AND item_id = ?',
        [cart_id, item_id],
        (err, item) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          if (item) {
            // Update existing item
            const newCount = item.count + count;
            
            if (newCount <= 0) {
              // Remove item if count is 0 or negative
              db.run(
                'DELETE FROM cart_items WHERE cart_id = ? AND item_id = ?',
                [cart_id, item_id],
                function(err) {
                  if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                  }
                  res.status(200).json({ message: 'Item removed successfully' });
                }
              );
            } else {
              // Update count
              db.run(
                'UPDATE cart_items SET count = ? WHERE cart_id = ? AND item_id = ?',
                [newCount, cart_id, item_id],
                function(err) {
                  if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                  }
                  res.status(200).json({ message: 'Item updated successfully' });
                }
              );
            }
          } else {
            // Add new item
            if (count <= 0) {
              return res.status(400).json({ error: 'Cannot add item with count <= 0' });
            }
            
            db.run(
              'INSERT INTO cart_items (cart_id, item_id, count) VALUES (?, ?, ?)',
              [cart_id, item_id, count],
              function(err) {
                if (err) {
                  console.error('Database error:', err);
                  return res.status(500).json({ error: 'Internal server error' });
                }
                res.status(200).json({ message: 'Item added successfully' });
              }
            );
          }
        }
      );
    });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retrieve cart endpoint
app.post('/retrieve_cart', (req, res) => {
  try {
    const { cart_id } = req.body;
    
    // Validate required fields
    if (cart_id === undefined || cart_id === null) {
      return res.status(400).json({ error: 'cart_id is required' });
    }
    
    // Validate input
    if (!isValidCartId(cart_id)) {
      return res.status(400).json({ error: 'Invalid cart_id format' });
    }
    
    // Check if cart exists
    db.get('SELECT cart_id FROM carts WHERE cart_id = ?', [cart_id], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'Cart not found' });
      }
      
      // Get all items in cart
      db.all(
        'SELECT item_id, count FROM cart_items WHERE cart_id = ? ORDER BY item_id',
        [cart_id],
        (err, rows) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
          }
          
          const items = rows.map(row => ({
            item_id: row.item_id,
            count: row.count
          }));
          
          res.status(200).json({ items });
        }
      );
    });
  } catch (error) {
    console.error('Error retrieving cart:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server and database connection');
  server.close(() => {
    db.close(() => {
      console.log('Server and database connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server and database connection');
  server.close(() => {
    db.close(() => {
      console.log('Server and database connection closed');
      process.exit(0);
    });
  });
});