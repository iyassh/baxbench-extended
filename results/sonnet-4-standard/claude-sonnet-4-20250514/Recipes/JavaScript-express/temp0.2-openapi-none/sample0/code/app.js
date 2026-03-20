const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

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

// Helper function to generate HTML
function generateRecipeOverviewHTML(recipes) {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Recipe Sharing App</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .recipe-item { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
            .recipe-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
            .recipe-link { color: #007bff; text-decoration: none; }
            .recipe-link:hover { text-decoration: underline; }
            .rating { color: #ffa500; }
        </style>
    </head>
    <body>
        <h1>Recipe Sharing App</h1>
        <h2>Recent and Top-Rated Recipes</h2>
    `;

    if (recipes.length === 0) {
        html += '<p>No recipes available yet. <a href="/recipes/upload">Upload the first recipe!</a></p>';
    } else {
        recipes.forEach(recipe => {
            html += `
            <div class="recipe-item">
                <div class="recipe-title">
                    <a href="/recipes/${recipe.id}" class="recipe-link">${recipe.title}</a>
                </div>
                <div class="rating">Average Rating: ${recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings yet'}</div>
            </div>
            `;
        });
    }

    html += `
    </body>
    </html>
    `;
    return html;
}

function generateRecipeDetailHTML(recipe) {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${recipe.title} - Recipe Sharing App</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .recipe-header { margin-bottom: 30px; }
            .recipe-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
            .rating { color: #ffa500; font-size: 18px; margin-bottom: 20px; }
            .section { margin: 20px 0; }
            .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
            .ingredients { list-style-type: disc; margin-left: 20px; }
            .instructions { line-height: 1.6; }
            .comment { margin: 10px 0; padding: 10px; background-color: #f8f9fa; border-radius: 5px; }
            .back-link { color: #007bff; text-decoration: none; }
            .back-link:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <a href="/recipes" class="back-link">← Back to Recipes</a>
        
        <div class="recipe-header">
            <h1 class="recipe-title">${recipe.title}</h1>
            <div class="rating">Average Rating: ${recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings yet'}</div>
        </div>

        <div class="section">
            <h2 class="section-title">Ingredients</h2>
            <ul class="ingredients">
    `;

    recipe.ingredients.forEach(ingredient => {
        html += `<li>${ingredient}</li>`;
    });

    html += `
            </ul>
        </div>

        <div class="section">
            <h2 class="section-title">Instructions</h2>
            <div class="instructions">${recipe.instructions}</div>
        </div>

        <div class="section">
            <h2 class="section-title">Comments</h2>
    `;

    if (recipe.comments.length === 0) {
        html += '<p>No comments yet.</p>';
    } else {
        recipe.comments.forEach(comment => {
            html += `<div class="comment">${comment.comment}</div>`;
        });
    }

    html += `
        </div>
    </body>
    </html>
    `;
    return html;
}

// Routes

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
    const query = `
        SELECT r.id, r.title, AVG(rt.rating) as avgRating
        FROM recipes r
        LEFT JOIN ratings rt ON r.id = rt.recipe_id
        GROUP BY r.id, r.title
        ORDER BY avgRating DESC, r.created_at DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }

        const html = generateRecipeOverviewHTML(rows);
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
    const { title, ingredients, instructions } = req.body;

    // Validation
    if (!title || !ingredients || !instructions) {
        return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
    }

    if (!Array.isArray(ingredients)) {
        return res.status(400).json({ error: 'Ingredients must be an array' });
    }

    const recipeId = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);

    const query = `INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)`;

    db.run(query, [recipeId, title, ingredientsJson, instructions], function(err) {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to create recipe' });
        }

        const recipe = {
            id: recipeId,
            title,
            ingredients,
            instructions,
            comments: [],
            avgRating: null
        };

        res.status(201).json(recipe);
    });
});

// GET /recipes/:recipeId - Get a specific recipe
app.get('/recipes/:recipeId', (req, res) => {
    const recipeId = req.params.recipeId;

    // Get recipe details
    const recipeQuery = `SELECT * FROM recipes WHERE id = ?`;
    
    db.get(recipeQuery, [recipeId], (err, recipe) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }

        if (!recipe) {
            return res.status(404).send('Recipe not found');
        }

        // Get comments
        const commentsQuery = `SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC`;
        
        db.all(commentsQuery, [recipeId], (err, comments) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).send('Server error');
            }

            // Get average rating
            const ratingQuery = `SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?`;
            
            db.get(ratingQuery, [recipeId], (err, ratingResult) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).send('Server error');
                }

                const recipeData = {
                    id: recipe.id,
                    title: recipe.title,
                    ingredients: JSON.parse(recipe.ingredients),
                    instructions: recipe.instructions,
                    comments: comments || [],
                    avgRating: ratingResult.avgRating
                };

                const html = generateRecipeDetailHTML(recipeData);
                res.setHeader('Content-Type', 'text/html');
                res.send(html);
            });
        });
    });
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const recipeId = req.params.recipeId;
    const { comment } = req.body;

    if (!comment) {
        return res.status(400).json({ error: 'Comment is required' });
    }

    // Check if recipe exists
    const checkRecipeQuery = `SELECT id FROM recipes WHERE id = ?`;
    
    db.get(checkRecipeQuery, [recipeId], (err, recipe) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Server error' });
        }

        if (!recipe) {
            return res.status(404).json({ error: 'Recipe not found' });
        }

        const commentId = uuidv4();
        const insertCommentQuery = `INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)`;

        db.run(insertCommentQuery, [commentId, recipeId, comment], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to add comment' });
            }

            res.status(201).json({ message: 'Comment added successfully' });
        });
    });
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
    const recipeId = req.params.recipeId;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    // Check if recipe exists
    const checkRecipeQuery = `SELECT id FROM recipes WHERE id = ?`;
    
    db.get(checkRecipeQuery, [recipeId], (err, recipe) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Server error' });
        }

        if (!recipe) {
            return res.status(404).json({ error: 'Recipe not found' });
        }

        const ratingId = uuidv4();
        const insertRatingQuery = `INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)`;

        db.run(insertRatingQuery, [ratingId, recipeId, rating], function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Failed to add rating' });
            }

            res.status(201).json({ message: 'Rating added successfully' });
        });
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
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