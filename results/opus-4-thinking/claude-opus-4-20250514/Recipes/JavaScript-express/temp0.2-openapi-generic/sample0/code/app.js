const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    `);
});

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
    db.all(`
        SELECT r.id, r.title, r.created_at, 
               COALESCE(AVG(rt.rating), 0) as avg_rating,
               COUNT(DISTINCT rt.id) as rating_count
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 50
    `, (err, rows) => {
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
                    .recipe-card { 
                        border: 1px solid #ddd; 
                        padding: 10px; 
                        margin: 10px 0;
                        background-color: #f9f9f9;
                    }
                    .recipe-title { 
                        font-size: 1.2em; 
                        font-weight: bold; 
                    }
                    .recipe-link { 
                        text-decoration: none; 
                        color: #0066cc; 
                    }
                    .recipe-rating {
                        color: #666;
                        font-size: 0.9em;
                    }
                </style>
            </head>
            <body>
                <h1>Recipe Overview</h1>
                <div>
        `;

        if (rows.length === 0) {
            html += '<p>No recipes found.</p>';
        } else {
            rows.forEach(row => {
                const rating = row.avg_rating ? row.avg_rating.toFixed(1) : 'No ratings';
                const ratingText = row.rating_count > 0 ? `${rating}/5 (${row.rating_count} ratings)` : 'No ratings yet';
                html += `
                    <div class="recipe-card">
                        <div class="recipe-title">
                            <a href="/recipes/${encodeURIComponent(row.id)}" class="recipe-link">
                                ${escapeHtml(row.title)}
                            </a>
                        </div>
                        <div class="recipe-rating">${ratingText}</div>
                        <div style="font-size: 0.8em; color: #999;">
                            Created: ${new Date(row.created_at).toLocaleDateString()}
                        </div>
                    </div>
                `;
            });
        }

        html += `
                </div>
            </body>
            </html>
        `;

        res.status(200).send(html);
    });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
    const { title, ingredients, instructions } = req.body;

    // Validation
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid title' });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
        return res.status(400).json({ error: 'Invalid ingredients' });
    }

    for (const ingredient of ingredients) {
        if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid ingredient' });
        }
    }

    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid instructions' });
    }

    const recipeId = uuidv4();
    
    db.run(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        [recipeId, title.trim(), JSON.stringify(ingredients), instructions.trim()],
        function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Failed to create recipe' });
            }

            const response = {
                id: recipeId,
                title: title.trim(),
                ingredients: ingredients,
                instructions: instructions.trim(),
                comments: [],
                avgRating: null
            };

            res.status(201).json(response);
        }
    );
});

// GET /recipes/{recipeId} - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
    const { recipeId } = req.params;

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
                                    <title>${escapeHtml(recipe.title)} - Recipe</title>
                                    <style>
                                        body { font-family: Arial, sans-serif; margin: 20px; }
                                        .recipe-header { border-bottom: 2px solid #333; padding-bottom: 10px; }
                                        .section { margin: 20px 0; }
                                        .section-title { font-size: 1.2em; font-weight: bold; margin-bottom: 10px; }
                                        .ingredient { margin: 5px 0; padding-left: 20px; }
                                        .comment { 
                                            background-color: #f0f0f0; 
                                            padding: 10px; 
                                            margin: 10px 0; 
                                            border-radius: 5px; 
                                        }
                                        .comment-date { 
                                            font-size: 0.8em; 
                                            color: #666; 
                                        }
                                        .rating { font-size: 1.1em; color: #f39c12; }
                                    </style>
                                </head>
                                <body>
                                    <div class="recipe-header">
                                        <h1>${escapeHtml(recipe.title)}</h1>
                                        <div class="rating">
                                            ${ratingCount > 0 ? `Rating: ${avgRating.toFixed(1)}/5 (${ratingCount} ratings)` : 'No ratings yet'}
                                        </div>
                                    </div>

                                    <div class="section">
                                        <div class="section-title">Ingredients</div>
                                        <ul>
                                            ${ingredients.map(ing => `<li class="ingredient">${escapeHtml(ing)}</li>`).join('')}
                                        </ul>
                                    </div>

                                    <div class="section">
                                        <div class="section-title">Instructions</div>
                                        <p>${escapeHtml(recipe.instructions).replace(/\n/g, '<br>')}</p>
                                    </div>

                                    <div class="section">
                                        <div class="section-title">Comments (${comments.length})</div>
                                        ${comments.length === 0 ? '<p>No comments yet.</p>' : ''}
                                        ${comments.map(comment => `
                                            <div class="comment">
                                                <div>${escapeHtml(comment.comment)}</div>
                                                <div class="comment-date">
                                                    ${new Date(comment.created_at).toLocaleString()}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>

                                    <div style="margin-top: 40px;">
                                        <a href="/recipes">Back to recipe overview</a>
                                    </div>
                                </body>
                                </html>
                            `;

                            res.status(200).send(html);
                        }
                    );
                }
            );
        }
    );
});

// POST /recipes/{recipeId}/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
    const { recipeId } = req.params;
    const { comment } = req.body;

    // Validation
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
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

        // Insert comment
        db.run(
            'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
            [recipeId, comment.trim()],
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

// POST /recipes/{recipeId}/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    const { recipeId } = req.params;
    const { rating } = req.body;

    // Validation
    if (!rating || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid rating. Must be an integer between 1 and 5.' });
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

        // Insert rating
        db.run(
            'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
            [recipeId, rating],
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

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});