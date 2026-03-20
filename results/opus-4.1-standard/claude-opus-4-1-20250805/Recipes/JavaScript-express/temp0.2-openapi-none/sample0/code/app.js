const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

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

// GET /recipes - Get an overview of recipes
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
            return res.status(500).send('Server error');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Overview</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .recipe { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
                    .recipe h3 { margin: 0 0 10px 0; }
                    .rating { color: #f39c12; }
                    a { color: #3498db; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Recipe Collection</h1>
                <div class="recipes">
        `;
        
        recipes.forEach(recipe => {
            const rating = recipe.avg_rating ? recipe.avg_rating.toFixed(1) : 'No ratings';
            html += `
                <div class="recipe">
                    <h3><a href="/recipes/${recipe.id}">${recipe.title}</a></h3>
                    <p class="rating">Rating: ${rating} (${recipe.rating_count} ratings)</p>
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
    
    if (!title || !ingredients || !instructions || !Array.isArray(ingredients)) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    
    const id = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);
    
    db.run(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        [id, title, ingredientsJson, instructions],
        function(err) {
            if (err) {
                return res.status(400).json({ error: 'Invalid input' });
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

// GET /recipes/{recipeId} - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
    const { recipeId } = req.params;
    
    db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
        if (err || !recipe) {
            return res.status(404).send('Recipe not found');
        }
        
        db.all('SELECT * FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
            if (err) comments = [];
            
            db.get('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingData) => {
                const avgRating = ratingData && ratingData.avg_rating ? ratingData.avg_rating.toFixed(1) : 'No ratings';
                const ratingCount = ratingData ? ratingData.count : 0;
                
                let ingredients;
                try {
                    ingredients = JSON.parse(recipe.ingredients);
                } catch {
                    ingredients = [];
                }
                
                let html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${recipe.title}</title>
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
                            h1 { color: #2c3e50; }
                            .section { margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; }
                            .ingredients li { margin: 5px 0; }
                            .instructions { white-space: pre-wrap; }
                            .rating { color: #f39c12; font-size: 1.2em; margin: 10px 0; }
                            .comment { margin: 10px 0; padding: 10px; background: white; border-left: 3px solid #3498db; }
                            .comment-date { color: #7f8c8d; font-size: 0.9em; }
                        </style>
                    </head>
                    <body>
                        <h1>${recipe.title}</h1>
                        <div class="rating">⭐ Rating: ${avgRating} (${ratingCount} ratings)</div>
                        
                        <div class="section">
                            <h2>Ingredients</h2>
                            <ul class="ingredients">
                `;
                
                ingredients.forEach(ingredient => {
                    html += `<li>${ingredient}</li>`;
                });
                
                html += `
                            </ul>
                        </div>
                        
                        <div class="section">
                            <h2>Instructions</h2>
                            <div class="instructions">${recipe.instructions}</div>
                        </div>
                        
                        <div class="section">
                            <h2>Comments (${comments.length})</h2>
                `;
                
                if (comments.length === 0) {
                    html += '<p>No comments yet.</p>';
                } else {
                    comments.forEach(comment => {
                        html += `
                            <div class="comment">
                                <div>${comment.comment}</div>
                                <div class="comment-date">${new Date(comment.created_at).toLocaleString()}</div>
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

// POST /recipes/{recipeId}/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
    const { recipeId } = req.params;
    const { comment } = req.body;
    
    if (!comment) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    
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
                    return res.status(400).json({ error: 'Invalid input' });
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
    
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid input' });
    }
    
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
                    return res.status(400).json({ error: 'Invalid input' });
                }
                
                res.status(201).json({ message: 'Rating added successfully' });
            }
        );
    });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});