const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    `);
});

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
    db.all(`
        SELECT r.id, r.title, 
               COALESCE(AVG(rt.rating), 0) as avg_rating,
               COUNT(DISTINCT rt.id) as rating_count
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 20
    `, (err, recipes) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Server error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Overview</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .recipe { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
                    .recipe h3 { margin: 0 0 10px 0; }
                    .rating { color: #666; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Recipe Overview</h1>
                <div class="recipes">
        `;
        
        recipes.forEach(recipe => {
            const rating = recipe.rating_count > 0 
                ? `Rating: ${recipe.avg_rating.toFixed(1)}/5 (${recipe.rating_count} ratings)` 
                : 'No ratings yet';
            html += `
                <div class="recipe">
                    <h3>${escapeHtml(recipe.title)}</h3>
                    <p class="rating">${rating}</p>
                    <a href="/recipes/${escapeHtml(recipe.id)}">View Recipe</a>
                </div>
            `;
        });
        
        html += `
                </div>
            </body>
            </html>
        `;
        
        res.status(200).type('text/html').send(html);
    });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
    const { title, ingredients, instructions } = req.body;
    
    // Validate input
    if (!title || !ingredients || !instructions) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!Array.isArray(ingredients)) {
        return res.status(400).json({ error: 'Ingredients must be an array' });
    }
    
    if (typeof title !== 'string' || typeof instructions !== 'string') {
        return res.status(400).json({ error: 'Invalid input types' });
    }
    
    if (title.length > 200 || instructions.length > 5000) {
        return res.status(400).json({ error: 'Input too long' });
    }
    
    const id = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);
    
    db.run(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        [id, title, ingredientsJson, instructions],
        function(err) {
            if (err) {
                console.error(err);
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
});

// GET /recipes/:recipeId - Get a specific recipe
app.get('/recipes/:recipeId', (req, res) => {
    const recipeId = req.params.recipeId;
    
    // Validate UUID format
    if (!recipeId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        return res.status(404).send('Recipe not found');
    }
    
    db.get(
        'SELECT * FROM recipes WHERE id = ?',
        [recipeId],
        (err, recipe) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Server error');
            }
            
            if (!recipe) {
                return res.status(404).send('Recipe not found');
            }
            
            // Get comments
            db.all(
                'SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
                [recipeId],
                (err, comments) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).send('Server error');
                    }
                    
                    // Get average rating
                    db.get(
                        'SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM ratings WHERE recipe_id = ?',
                        [recipeId],
                        (err, ratingData) => {
                            if (err) {
                                console.error(err);
                                return res.status(500).send('Server error');
                            }
                            
                            const ingredients = JSON.parse(recipe.ingredients);
                            const avgRating = ratingData.avg_rating || 0;
                            const ratingCount = ratingData.count || 0;
                            
                            let html = `
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <title>${escapeHtml(recipe.title)}</title>
                                    <style>
                                        body { font-family: Arial, sans-serif; margin: 40px; }
                                        h1 { color: #333; }
                                        .section { margin: 30px 0; }
                                        .ingredients li { margin: 5px 0; }
                                        .instructions { line-height: 1.6; }
                                        .rating { font-size: 18px; color: #666; margin: 20px 0; }
                                        .comments { background: #f5f5f5; padding: 20px; border-radius: 5px; }
                                        .comment { background: white; padding: 10px; margin: 10px 0; border-radius: 3px; }
                                        .comment-date { color: #999; font-size: 12px; }
                                    </style>
                                </head>
                                <body>
                                    <h1>${escapeHtml(recipe.title)}</h1>
                                    
                                    <div class="rating">
                                        ${ratingCount > 0 
                                            ? `Average Rating: ${avgRating.toFixed(1)}/5 (${ratingCount} ratings)` 
                                            : 'No ratings yet'}
                                    </div>
                                    
                                    <div class="section">
                                        <h2>Ingredients</h2>
                                        <ul class="ingredients">
                            `;
                            
                            ingredients.forEach(ingredient => {
                                html += `<li>${escapeHtml(ingredient)}</li>`;
                            });
                            
                            html += `
                                        </ul>
                                    </div>
                                    
                                    <div class="section">
                                        <h2>Instructions</h2>
                                        <p class="instructions">${escapeHtml(recipe.instructions)}</p>
                                    </div>
                                    
                                    <div class="section comments">
                                        <h2>Comments</h2>
                            `;
                            
                            if (comments.length === 0) {
                                html += '<p>No comments yet.</p>';
                            } else {
                                comments.forEach(comment => {
                                    html += `
                                        <div class="comment">
                                            <p>${escapeHtml(comment.comment)}</p>
                                            <p class="comment-date">${new Date(comment.created_at).toLocaleString()}</p>
                                        </div>
                                    `;
                                });
                            }
                            
                            html += `
                                    </div>
                                </body>
                                </html>
                            `;
                            
                            res.status(200).type('text/html').send(html);
                        }
                    );
                }
            );
        }
    );
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const recipeId = req.params.recipeId;
    const { comment } = req.body;
    
    // Validate input
    if (!comment) {
        return res.status(400).json({ error: 'Comment is required' });
    }
    
    if (typeof comment !== 'string') {
        return res.status(400).json({ error: 'Comment must be a string' });
    }
    
    if (comment.length > 1000) {
        return res.status(400).json({ error: 'Comment too long' });
    }
    
    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server error' });
        }
        
        if (!recipe) {
            return res.status(404).json({ error: 'Recipe not found' });
        }
        
        const commentId = uuidv4();
        
        db.run(
            'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
            [commentId, recipeId, comment],
            function(err) {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Failed to add comment' });
                }
                
                res.status(201).json({ message: 'Comment added successfully' });
            }
        );
    });
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    const recipeId = req.params.recipeId;
    const { rating } = req.body;
    
    // Validate input
    if (rating === undefined || rating === null) {
        return res.status(400).json({ error: 'Rating is required' });
    }
    
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }
    
    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server error' });
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
                    console.error(err);
                    return res.status(500).json({ error: 'Failed to add rating' });
                }
                
                res.status(201).json({ message: 'Rating added successfully' });
            }
        );
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});