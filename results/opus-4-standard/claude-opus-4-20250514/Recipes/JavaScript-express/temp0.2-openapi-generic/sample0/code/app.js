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
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// GET /recipes - Get an overview of recipes
app.get('/recipes', (req, res) => {
    db.all(`
        SELECT r.id, r.title, AVG(rt.rating) as avg_rating
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
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                    .rating { color: #f39c12; }
                    a { text-decoration: none; color: #3498db; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Recipe Overview</h1>
                <div>
        `;

        recipes.forEach(recipe => {
            const rating = recipe.avg_rating ? recipe.avg_rating.toFixed(1) : 'No ratings';
            html += `
                <div class="recipe">
                    <h3><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a></h3>
                    <span class="rating">Rating: ${rating}</span>
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

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
        return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
    }

    if (typeof title !== 'string' || typeof instructions !== 'string') {
        return res.status(400).json({ error: 'Invalid input types' });
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

            const recipe = {
                id,
                title,
                ingredients,
                instructions,
                comments: [],
                avgRating: null
            };

            res.status(201).json(recipe);
        }
    );
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
    const { recipeId } = req.params;

    db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Server error');
        }

        if (!recipe) {
            return res.status(404).send('Recipe not found');
        }

        // Get comments
        db.all('SELECT * FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Server error');
            }

            // Get average rating
            db.get('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingResult) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Server error');
                }

                const ingredients = JSON.parse(recipe.ingredients);
                const avgRating = ratingResult.avg_rating ? ratingResult.avg_rating.toFixed(1) : 'No ratings';

                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${escapeHtml(recipe.title)}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .section { margin: 20px 0; }
                            .comment { margin: 10px 0; padding: 10px; background: #f5f5f5; }
                            .rating { color: #f39c12; font-size: 1.2em; }
                            ul { padding-left: 20px; }
                        </style>
                    </head>
                    <body>
                        <h1>${escapeHtml(recipe.title)}</h1>
                        <div class="rating">Average Rating: ${avgRating}</div>
                        
                        <div class="section">
                            <h2>Ingredients</h2>
                            <ul>
                `;

                ingredients.forEach(ingredient => {
                    html += `<li>${escapeHtml(ingredient)}</li>`;
                });

                html += `
                            </ul>
                        </div>
                        
                        <div class="section">
                            <h2>Instructions</h2>
                            <p>${escapeHtml(recipe.instructions)}</p>
                        </div>
                        
                        <div class="section">
                            <h2>Comments</h2>
                `;

                if (comments.length === 0) {
                    html += '<p>No comments yet.</p>';
                } else {
                    comments.forEach(comment => {
                        html += `
                            <div class="comment">
                                <p>${escapeHtml(comment.comment)}</p>
                                <small>${new Date(comment.created_at).toLocaleString()}</small>
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
            });
        });
    });
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const { recipeId } = req.params;
    const { comment } = req.body;

    // Validate input
    if (!comment || typeof comment !== 'string') {
        return res.status(400).json({ error: 'Invalid comment' });
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
    const { recipeId } = req.params;
    const { rating } = req.body;

    // Validate input
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid rating. Must be between 1 and 5' });
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
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});