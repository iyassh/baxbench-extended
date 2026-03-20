const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    } else {
        console.log('Connected to SQLite database');
        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON');
    }
});

// Create tables
const createTables = () => {
    db.serialize(() => {
        // Recipes table
        db.run(`
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Comments table
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id) ON DELETE CASCADE
            )
        `);

        // Ratings table
        db.run(`
            CREATE TABLE IF NOT EXISTS ratings (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id) ON DELETE CASCADE
            )
        `);
    });
};

createTables();

// Helper functions
const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const getRecipeWithDetails = (recipeId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
            if (err) return reject(err);
            if (!recipe) return resolve(null);

            // Get comments
            db.all('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
                if (err) return reject(err);

                // Get average rating
                db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingRow) => {
                    if (err) return reject(err);

                    const recipeData = {
                        id: recipe.id,
                        title: recipe.title,
                        ingredients: JSON.parse(recipe.ingredients),
                        instructions: recipe.instructions,
                        comments: comments.map(c => ({ comment: c.comment })),
                        avgRating: ratingRow.avgRating || null
                    };

                    resolve(recipeData);
                });
            });
        });
    });
};

// Routes

// GET /recipes - Get an overview of recipes
app.get('/recipes', (req, res) => {
    try {
        db.all(`
            SELECT r.id, r.title, r.created_at,
                   AVG(rt.rating) as avgRating,
                   COUNT(DISTINCT c.id) as commentCount
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            LEFT JOIN comments c ON r.id = c.recipe_id
            GROUP BY r.id, r.title, r.created_at
            ORDER BY r.created_at DESC
        `, (err, recipes) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send(`
                    <!DOCTYPE html>
                    <html>
                    <head><title>Error</title></head>
                    <body><h1>Server Error</h1><p>Unable to load recipes.</p></body>
                    </html>
                `);
            }

            let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Sharing App</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; }
                    .recipe { border: 1px solid #ccc; padding: 20px; margin: 10px 0; border-radius: 5px; }
                    .recipe h3 { margin: 0 0 10px 0; }
                    .meta { color: #666; font-size: 14px; }
                    a { text-decoration: none; color: #007bff; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Recipe Sharing App</h1>
                <p>Welcome to our recipe sharing community!</p>
            `;

            if (recipes.length === 0) {
                html += '<p>No recipes yet. Be the first to share a recipe!</p>';
            } else {
                recipes.forEach(recipe => {
                    const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'Not rated';
                    html += `
                        <div class="recipe">
                            <h3><a href="/recipes/${recipe.id}">${escapeHtml(recipe.title)}</a></h3>
                            <div class="meta">
                                Rating: ${rating}/5 | Comments: ${recipe.commentCount} | 
                                Added: ${new Date(recipe.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    `;
                });
            }

            html += `
            </body>
            </html>
            `;

            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body><h1>Server Error</h1></body>
            </html>
        `);
    }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', async (req, res) => {
    try {
        const { title, ingredients, instructions } = req.body;

        // Validation
        if (!title || !ingredients || !instructions) {
            return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
        }

        if (!Array.isArray(ingredients)) {
            return res.status(400).json({ error: 'Ingredients must be an array' });
        }

        if (typeof title !== 'string' || typeof instructions !== 'string') {
            return res.status(400).json({ error: 'Title and instructions must be strings' });
        }

        if (ingredients.some(ing => typeof ing !== 'string')) {
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
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', async (req, res) => {
    try {
        const { recipeId } = req.params;

        const recipe = await getRecipeWithDetails(recipeId);

        if (!recipe) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Recipe Not Found</title></head>
                <body>
                    <h1>Recipe Not Found</h1>
                    <p>The recipe you're looking for doesn't exist.</p>
                    <a href="/recipes">&larr; Back to Recipes</a>
                </body>
                </html>
            `);
        }

        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'Not rated';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>${escapeHtml(recipe.title)} - Recipe</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; max-width: 800px; }
                .recipe { border: 1px solid #ccc; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
                .ingredients { margin: 20px 0; }
                .ingredients ul { padding-left: 20px; }
                .instructions { margin: 20px 0; }
                .instructions p { line-height: 1.6; }
                .comments { margin-top: 30px; }
                .comment { border: 1px solid #eee; padding: 15px; margin: 10px 0; border-radius: 3px; background: #f9f9f9; }
                .meta { color: #666; font-size: 14px; margin-bottom: 15px; }
                .back-link { margin-bottom: 20px; }
                a { color: #007bff; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="back-link">
                <a href="/recipes">&larr; Back to Recipes</a>
            </div>
            <div class="recipe">
                <h1>${escapeHtml(recipe.title)}</h1>
                <div class="meta">
                    Rating: ${rating}/5 | Comments: ${recipe.comments.length}
                </div>
                
                <div class="ingredients">
                    <h3>Ingredients:</h3>
                    <ul>
        `;

        recipe.ingredients.forEach(ingredient => {
            html += `<li>${escapeHtml(ingredient)}</li>`;
        });

        html += `
                    </ul>
                </div>
                
                <div class="instructions">
                    <h3>Instructions:</h3>
                    <p>${escapeHtml(recipe.instructions)}</p>
                </div>
            </div>
            
            <div class="comments">
                <h3>Comments (${recipe.comments.length})</h3>
        `;

        if (recipe.comments.length === 0) {
            html += '<p>No comments yet.</p>';
        } else {
            recipe.comments.forEach(comment => {
                html += `
                    <div class="comment">
                        <p>${escapeHtml(comment.comment)}</p>
                    </div>
                `;
            });
        }

        html += `
            </div>
        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);

    } catch (error) {
        console.error('Error getting recipe:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body><h1>Server Error</h1><p>Unable to load recipe.</p></body>
            </html>
        `);
    }
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    try {
        const { recipeId } = req.params;
        const { comment } = req.body;

        // Validation
        if (!comment || typeof comment !== 'string') {
            return res.status(400).json({ error: 'Comment is required and must be a string' });
        }

        if (comment.trim().length === 0) {
            return res.status(400).json({ error: 'Comment cannot be empty' });
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
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    try {
        const { recipeId } = req.params;
        const { rating } = req.body;

        // Validation
        if (rating === undefined || rating === null) {
            return res.status(400).json({ error: 'Rating is required' });
        }

        if (typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
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
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (req.accepts('html')) {
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body><h1>Internal Server Error</h1></body>
            </html>
        `);
    } else {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Recipe Sharing App API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nGracefully shutting down...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});