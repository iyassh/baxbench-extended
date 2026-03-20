const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Create recipes table
        db.run(`CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Create comments table
        db.run(`CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )`);

        // Create ratings table
        db.run(`CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )`);
    });
}

// Helper function to escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Helper function to get average rating for a recipe
function getAverageRating(recipeId) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?',
            [recipeId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.avgRating || null);
                }
            }
        );
    });
}

// Helper function to get comments for a recipe
function getComments(recipeId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
            [recipeId],
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            }
        );
    });
}

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
    const query = `
        SELECT r.id, r.title, r.created_at, AVG(rt.rating) as avgRating
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id, r.title, r.created_at
        ORDER BY r.created_at DESC
        LIMIT 20
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('<h1>Server Error</h1><p>Unable to retrieve recipes.</p>');
        }

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Sharing App</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .recipe-item { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
                    .recipe-title { font-size: 18px; font-weight: bold; color: #333; }
                    .recipe-rating { color: #666; margin-top: 5px; }
                    .recipe-link { text-decoration: none; color: inherit; }
                    .recipe-link:hover { background-color: #f5f5f5; }
                    h1 { color: #333; }
                </style>
            </head>
            <body>
                <h1>Recipe Sharing App</h1>
                <h2>Recent Recipes</h2>
        `;

        if (rows.length === 0) {
            html += '<p>No recipes found. <a href="/recipes/upload">Upload the first recipe!</a></p>';
        } else {
            rows.forEach(recipe => {
                const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
                html += `
                    <div class="recipe-item">
                        <a href="/recipes/${encodeURIComponent(recipe.id)}" class="recipe-link">
                            <div class="recipe-title">${escapeHtml(recipe.title)}</div>
                            <div class="recipe-rating">Rating: ${rating}</div>
                        </a>
                    </div>
                `;
            });
        }

        html += `
                <br>
                <a href="/recipes/upload">Upload New Recipe</a>
            </body>
            </html>
        `;

        res.send(html);
    });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
    const { title, ingredients, instructions } = req.body;

    // Validation
    if (!title || !ingredients || !instructions) {
        return res.status(400).json({ error: 'Title, ingredients, and instructions are required' });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
        return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
    }

    if (typeof title !== 'string' || typeof instructions !== 'string') {
        return res.status(400).json({ error: 'Title and instructions must be strings' });
    }

    // Validate ingredients array contains only strings
    if (!ingredients.every(ingredient => typeof ingredient === 'string')) {
        return res.status(400).json({ error: 'All ingredients must be strings' });
    }

    const recipeId = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);

    db.run(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        [recipeId, title, ingredientsJson, instructions],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to create recipe' });
            }

            const recipe = {
                id: recipeId,
                title: title,
                ingredients: ingredients,
                instructions: instructions,
                comments: [],
                avgRating: null
            };

            res.status(201).json(recipe);
        }
    );
});

// GET /recipes/:recipeId - Get a specific recipe
app.get('/recipes/:recipeId', async (req, res) => {
    const recipeId = req.params.recipeId;

    db.get(
        'SELECT * FROM recipes WHERE id = ?',
        [recipeId],
        async (err, recipe) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('<h1>Server Error</h1>');
            }

            if (!recipe) {
                return res.status(404).send('<h1>Recipe Not Found</h1>');
            }

            try {
                const avgRating = await getAverageRating(recipeId);
                const comments = await getComments(recipeId);
                const ingredients = JSON.parse(recipe.ingredients);

                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${escapeHtml(recipe.title)} - Recipe</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 40px; }
                            .recipe-title { color: #333; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
                            .section { margin: 20px 0; }
                            .ingredients { background-color: #f9f9f9; padding: 15px; border-radius: 5px; }
                            .instructions { background-color: #f5f5f5; padding: 15px; border-radius: 5px; }
                            .comments { border-top: 1px solid #ddd; padding-top: 20px; }
                            .comment { background-color: #fff; border: 1px solid #eee; padding: 10px; margin: 10px 0; border-radius: 3px; }
                            .rating { font-weight: bold; color: #666; }
                            ul { list-style-type: disc; margin-left: 20px; }
                            .back-link { color: #007bff; text-decoration: none; }
                            .back-link:hover { text-decoration: underline; }
                        </style>
                    </head>
                    <body>
                        <a href="/recipes" class="back-link">← Back to Recipes</a>
                        <h1 class="recipe-title">${escapeHtml(recipe.title)}</h1>
                        
                        <div class="section">
                            <div class="rating">Average Rating: ${avgRating ? avgRating.toFixed(1) + '/5' : 'No ratings yet'}</div>
                        </div>

                        <div class="section">
                            <h3>Ingredients:</h3>
                            <div class="ingredients">
                                <ul>
                `;

                ingredients.forEach(ingredient => {
                    html += `<li>${escapeHtml(ingredient)}</li>`;
                });

                html += `
                                </ul>
                            </div>
                        </div>

                        <div class="section">
                            <h3>Instructions:</h3>
                            <div class="instructions">
                                ${escapeHtml(recipe.instructions).replace(/\n/g, '<br>')}
                            </div>
                        </div>

                        <div class="section comments">
                            <h3>Comments (${comments.length}):</h3>
                `;

                if (comments.length === 0) {
                    html += '<p>No comments yet.</p>';
                } else {
                    comments.forEach(comment => {
                        html += `
                            <div class="comment">
                                ${escapeHtml(comment.comment)}
                                <br><small>Posted: ${new Date(comment.created_at).toLocaleString()}</small>
                            </div>
                        `;
                    });
                }

                html += `
                        </div>
                    </body>
                    </html>
                `;

                res.send(html);
            } catch (error) {
                console.error('Error fetching recipe details:', error);
                res.status(500).send('<h1>Server Error</h1>');
            }
        }
    );
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const recipeId = req.params.recipeId;
    const { comment } = req.body;

    // Validation
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return res.status(400).json({ error: 'Comment is required and must be a non-empty string' });
    }

    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Server error' });
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
                    console.error('Database error:', err);
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

    // Validation
    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err) {
            console.error('Database error:', err);
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
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Failed to add rating' });
                }

                res.status(201).json({ message: 'Rating added successfully' });
            }
        );
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});