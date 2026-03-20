const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Database setup
const db = new sqlite3.Database('db.sqlite3');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
        token TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Clean up old CSRF tokens periodically
setInterval(() => {
    db.run(`DELETE FROM csrf_tokens WHERE datetime(created_at) < datetime('now', '-1 hour')`, (err) => {
        if (err) console.error('Error cleaning CSRF tokens');
    });
}, 3600000); // Every hour

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';");
    next();
});

// Generate CSRF token
const generateCSRFToken = () => {
    const token = crypto.randomBytes(32).toString('hex');
    db.run('INSERT INTO csrf_tokens (token) VALUES (?)', [token], (err) => {
        if (err) console.error('Error saving CSRF token');
    });
    return token;
};

// Validate CSRF token
const validateCSRFToken = (token, callback) => {
    if (!token) return callback(false);
    db.get('SELECT token FROM csrf_tokens WHERE token = ?', [token], (err, row) => {
        callback(!err && row);
    });
};

// HTML escaping function for XSS prevention
const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Input validation helper
const validateString = (str, maxLength = 10000) => {
    return typeof str === 'string' && str.trim().length > 0 && str.length <= maxLength;
};

// GET /recipes - Get an overview of recipes
app.get('/recipes', (req, res) => {
    db.all(`SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 20`, (err, recipes) => {
        if (err) {
            console.error('Database error');
            return res.status(500).send('<html><body>Server error</body></html>');
        }
        
        let html = `<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .recipe { margin: 10px 0; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <div class="recipes">`;
        
        if (recipes.length === 0) {
            html += '<p>No recipes available yet.</p>';
        } else {
            recipes.forEach(recipe => {
                html += `<div class="recipe">
                    <a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>
                </div>`;
            });
        }
        
        html += `</div>
</body>
</html>`;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
    // For API endpoints, check CSRF token if provided (optional for pure API usage)
    const csrfToken = req.headers['x-csrf-token'];
    
    const processRequest = () => {
        const { title, ingredients, instructions } = req.body;
        
        // Input validation
        if (!validateString(title, 200)) {
            return res.status(400).json({ error: 'Invalid title' });
        }
        
        if (!Array.isArray(ingredients) || ingredients.length === 0 || ingredients.length > 100) {
            return res.status(400).json({ error: 'Invalid ingredients' });
        }
        
        for (const ingredient of ingredients) {
            if (!validateString(ingredient, 200)) {
                return res.status(400).json({ error: 'Invalid ingredient' });
            }
        }
        
        if (!validateString(instructions, 5000)) {
            return res.status(400).json({ error: 'Invalid instructions' });
        }
        
        const id = uuidv4();
        const ingredientsJson = JSON.stringify(ingredients);
        
        db.run(
            'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
            [id, title, ingredientsJson, instructions],
            function(err) {
                if (err) {
                    console.error('Database error');
                    return res.status(500).json({ error: 'Failed to create recipe' });
                }
                
                res.status(201).json({
                    id,
                    title,
                    ingredients,
                    instructions,
                    comments: [],
                    avgRating: null
                });
            }
        );
    };
    
    // If CSRF token is provided, validate it
    if (csrfToken) {
        validateCSRFToken(csrfToken, (isValid) => {
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid CSRF token' });
            }
            processRequest();
        });
    } else {
        processRequest();
    }
});

// GET /recipes/{recipeId} - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
    const recipeId = req.params.recipeId;
    
    if (!validateString(recipeId, 50)) {
        return res.status(404).send('<html><body>Recipe not found</body></html>');
    }
    
    db.get(
        'SELECT * FROM recipes WHERE id = ?',
        [recipeId],
        (err, recipe) => {
            if (err || !recipe) {
                return res.status(404).send('<html><body>Recipe not found</body></html>');
            }
            
            // Get comments
            db.all(
                'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
                [recipeId],
                (err, comments) => {
                    if (err) {
                        console.error('Database error');
                        comments = [];
                    }
                    
                    // Get average rating
                    db.get(
                        'SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?',
                        [recipeId],
                        (err, ratingData) => {
                            if (err) {
                                console.error('Database error');
                            }
                            
                            const avgRating = ratingData && ratingData.avgRating ? ratingData.avgRating.toFixed(1) : 'No ratings yet';
                            const csrfToken = generateCSRFToken();
                            
                            let ingredients;
                            try {
                                ingredients = JSON.parse(recipe.ingredients);
                            } catch (e) {
                                ingredients = [];
                            }
                            
                            let html = `<!DOCTYPE html>
<html>
<head>
    <title>${escapeHtml(recipe.title)}</title>
    <meta charset="UTF-8">
    <meta name="csrf-token" content="${escapeHtml(csrfToken)}">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; }
        .ingredient { margin-left: 20px; }
        .comment { background: #f0f0f0; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .rating { font-weight: bold; color: #ff6600; }
    </style>
</head>
<body>
    <h1>${escapeHtml(recipe.title)}</h1>
    
    <div class="section">
        <h2>Average Rating</h2>
        <div class="rating">${escapeHtml(avgRating)}</div>
    </div>
    
    <div class="section">
        <h2>Ingredients</h2>`;
                            
                            ingredients.forEach(ingredient => {
                                html += `<div class="ingredient">• ${escapeHtml(ingredient)}</div>`;
                            });
                            
                            html += `</div>
    
    <div class="section">
        <h2>Instructions</h2>
        <p>${escapeHtml(recipe.instructions)}</p>
    </div>
    
    <div class="section">
        <h2>Comments</h2>`;
                            
                            if (comments.length === 0) {
                                html += '<p>No comments yet.</p>';
                            } else {
                                comments.forEach(comment => {
                                    html += `<div class="comment">${escapeHtml(comment.comment)}</div>`;
                                });
                            }
                            
                            html += `</div>
</body>
</html>`;
                            
                            res.setHeader('Content-Type', 'text/html');
                            res.send(html);
                        }
                    );
                }
            );
        }
    );
});

// POST /recipes/{recipeId}/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const recipeId = req.params.recipeId;
    const { comment } = req.body;
    const csrfToken = req.headers['x-csrf-token'];
    
    const processRequest = () => {
        if (!validateString(recipeId, 50)) {
            return res.status(404).json({ error: 'Recipe not found' });
        }
        
        if (!validateString(comment, 1000)) {
            return res.status(400).json({ error: 'Invalid comment' });
        }
        
        // Check if recipe exists
        db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err || !recipe) {
                return res.status(404).json({ error: 'Recipe not found' });
            }
            
            const commentId = uuidv4();
            
            db.run(
                'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
                [commentId, recipeId, comment],
                function(err) {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Failed to add comment' });
                    }
                    
                    res.status(201).json({ message: 'Comment added successfully' });
                }
            );
        });
    };
    
    // If CSRF token is provided, validate it
    if (csrfToken) {
        validateCSRFToken(csrfToken, (isValid) => {
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid CSRF token' });
            }
            processRequest();
        });
    } else {
        processRequest();
    }
});

// POST /recipes/{recipeId}/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    const recipeId = req.params.recipeId;
    const { rating } = req.body;
    const csrfToken = req.headers['x-csrf-token'];
    
    const processRequest = () => {
        if (!validateString(recipeId, 50)) {
            return res.status(404).json({ error: 'Recipe not found' });
        }
        
        if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Invalid rating. Must be an integer between 1 and 5' });
        }
        
        // Check if recipe exists
        db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err || !recipe) {
                return res.status(404).json({ error: 'Recipe not found' });
            }
            
            const ratingId = uuidv4();
            
            db.run(
                'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
                [ratingId, recipeId, rating],
                function(err) {
                    if (err) {
                        console.error('Database error');
                        return res.status(500).json({ error: 'Failed to add rating' });
                    }
                    
                    res.status(201).json({ message: 'Rating added successfully' });
                }
            );
        });
    };
    
    // If CSRF token is provided, validate it
    if (csrfToken) {
        validateCSRFToken(csrfToken, (isValid) => {
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid CSRF token' });
            }
            processRequest();
        });
    } else {
        processRequest();
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});