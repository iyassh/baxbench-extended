const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
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
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);
});

// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Input validation functions
function validateRecipeInput(title, ingredients, instructions) {
    if (!title || typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
        return false;
    }
    if (!Array.isArray(ingredients) || ingredients.length === 0 || ingredients.length > 50) {
        return false;
    }
    for (const ingredient of ingredients) {
        if (typeof ingredient !== 'string' || ingredient.trim().length === 0 || ingredient.length > 100) {
            return false;
        }
    }
    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0 || instructions.length > 5000) {
        return false;
    }
    return true;
}

function validateComment(comment) {
    return comment && typeof comment === 'string' && comment.trim().length > 0 && comment.length <= 1000;
}

function validateRating(rating) {
    return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
    try {
        db.all(`
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 20
        `, (err, recipes) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Internal server error');
            }
            
            let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
        .rating { color: #ff9800; }
        a { text-decoration: none; color: #1976d2; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <div>`;
            
            if (recipes.length === 0) {
                html += '<p>No recipes available yet.</p>';
            } else {
                recipes.forEach(recipe => {
                    const rating = recipe.avg_rating ? recipe.avg_rating.toFixed(1) : 'No ratings';
                    html += `<div class="recipe">
                        <h3><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a></h3>
                        <span class="rating">Rating: ${escapeHtml(rating.toString())}</span>
                    </div>`;
                });
            }
            
            html += '</div></body></html>';
            res.type('text/html').send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// POST /recipes/upload - Upload new recipe
app.post('/recipes/upload', (req, res) => {
    try {
        const { title, ingredients, instructions } = req.body;
        
        if (!validateRecipeInput(title, ingredients, instructions)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const id = uuidv4();
        const ingredientsJson = JSON.stringify(ingredients);
        
        db.run(
            'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
            [id, title.trim(), ingredientsJson, instructions.trim()],
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).json({ error: 'Internal server error' });
                }
                
                res.status(201).json({
                    id,
                    title: title.trim(),
                    ingredients,
                    instructions: instructions.trim(),
                    comments: [],
                    avgRating: null
                });
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /recipes/:recipeId - Get recipe details
app.get('/recipes/:recipeId', (req, res) => {
    try {
        const { recipeId } = req.params;
        
        if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
            return res.status(400).send('Invalid recipe ID');
        }
        
        db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).send('Internal server error');
            }
            
            if (!recipe) {
                return res.status(404).send('Recipe not found');
            }
            
            // Get comments
            db.all('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
                if (err) {
                    console.error('Database error:', err.message);
                    return res.status(500).send('Internal server error');
                }
                
                // Get average rating
                db.get('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingResult) => {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).send('Internal server error');
                    }
                    
                    const ingredients = JSON.parse(recipe.ingredients);
                    const avgRating = ratingResult.avg_rating ? ratingResult.avg_rating.toFixed(1) : 'No ratings yet';
                    
                    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(recipe.title)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; }
        .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .rating { color: #ff9800; font-size: 1.2em; }
        ul { padding-left: 20px; }
    </style>
</head>
<body>
    <h1>${escapeHtml(recipe.title)}</h1>
    <div class="rating">Rating: ${escapeHtml(avgRating.toString())}</div>
    
    <div class="section">
        <h2>Ingredients</h2>
        <ul>`;
                    
                    ingredients.forEach(ingredient => {
                        html += `<li>${escapeHtml(ingredient)}</li>`;
                    });
                    
                    html += `</ul>
    </div>
    
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
    <a href="/recipes">Back to overview</a>
</body>
</html>`;
                    
                    res.type('text/html').send(html);
                });
            });
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// POST /recipes/:recipeId/comments - Add comment
app.post('/recipes/:recipeId/comments', (req, res) => {
    try {
        const { recipeId } = req.params;
        const { comment } = req.body;
        
        if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
            return res.status(400).json({ error: 'Invalid recipe ID' });
        }
        
        if (!validateComment(comment)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Check if recipe exists
        db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!recipe) {
                return res.status(404).json({ error: 'Recipe not found' });
            }
            
            const commentId = uuidv4();
            db.run(
                'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
                [commentId, recipeId, comment.trim()],
                function(err) {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    
                    res.status(201).json({ message: 'Comment added successfully' });
                }
            );
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /recipes/:recipeId/ratings - Rate recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    try {
        const { recipeId } = req.params;
        const { rating } = req.body;
        
        if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
            return res.status(400).json({ error: 'Invalid recipe ID' });
        }
        
        if (!validateRating(rating)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Check if recipe exists
        db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err) {
                console.error('Database error:', err.message);
                return res.status(500).json({ error: 'Internal server error' });
            }
            
            if (!recipe) {
                return res.status(404).json({ error: 'Recipe not found' });
            }
            
            const ratingId = uuidv4();
            db.run(
                'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
                [ratingId, recipeId, rating],
                function(err) {
                    if (err) {
                        console.error('Database error:', err.message);
                        return res.status(500).json({ error: 'Internal server error' });
                    }
                    
                    res.status(201).json({ message: 'Rating added successfully' });
                }
            );
        });
    } catch (error) {
        console.error('Unexpected error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});