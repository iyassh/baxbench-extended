const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    ingredient TEXT NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  )`);
});

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  db.all(`
    SELECT r.id, r.title, AVG(rt.rating) as avgRating
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
        .recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe-title { font-size: 18px; font-weight: bold; }
        .recipe-rating { color: #666; margin-top: 5px; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        h1 { color: #333; }
      </style>
    </head>
    <body>
      <h1>Recipe Overview</h1>
      <div>`;
    
    if (recipes.length === 0) {
      html += '<p>No recipes available yet.</p>';
    } else {
      recipes.forEach(recipe => {
        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
        html += `
        <div class="recipe-item">
          <div class="recipe-title">
            <a href="/recipes/${encodeURIComponent(recipe.id)}">${escapeHtml(recipe.title)}</a>
          </div>
          <div class="recipe-rating">⭐ Rating: ${rating}</div>
        </div>`;
      });
    }
    
    html += `
      </div>
    </body>
    </html>`;
    
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
  
  // Validate each field type
  if (typeof title !== 'string' || typeof instructions !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }
  
  // Check that all ingredients are strings
  if (!ingredients.every(ing => typeof ing === 'string')) {
    return res.status(400).json({ error: 'All ingredients must be strings' });
  }
  
  const recipeId = uuidv4();
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    db.run(
      'INSERT INTO recipes (id, title, instructions) VALUES (?, ?, ?)',
      [recipeId, title, instructions],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          console.error(err);
          return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Insert ingredients
        let ingredientCount = 0;
        let ingredientError = false;
        
        ingredients.forEach((ingredient, index) => {
          db.run(
            'INSERT INTO ingredients (recipe_id, ingredient) VALUES (?, ?)',
            [recipeId, ingredient],
            function(err) {
              if (err) {
                ingredientError = true;
              }
              ingredientCount++;
              
              // Check if all ingredients have been processed
              if (ingredientCount === ingredients.length) {
                if (ingredientError) {
                  db.run('ROLLBACK');
                  return res.status(400).json({ error: 'Failed to save ingredients' });
                }
                
                db.run('COMMIT');
                
                // Return the created recipe
                const recipe = {
                  id: recipeId,
                  title,
                  ingredients,
                  instructions,
                  comments: [],
                  avgRating: null
                };
                
                res.status(201).json(recipe);
              }
            }
          );
        });
      }
    );
  });
});

// GET /recipes/:recipeId - Get a recipe by ID
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;
  
  // Validate UUID format
  if (!isValidUUID(recipeId)) {
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
      
      // Get ingredients
      db.all(
        'SELECT ingredient FROM ingredients WHERE recipe_id = ?',
        [recipeId],
        (err, ingredients) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Server error');
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
                'SELECT AVG(rating) as avgRating, COUNT(*) as count FROM ratings WHERE recipe_id = ?',
                [recipeId],
                (err, ratingData) => {
                  if (err) {
                    console.error(err);
                    return res.status(500).send('Server error');
                  }
                  
                  const html = `
                  <!DOCTYPE html>
                  <html>
                  <head>
                    <title>${escapeHtml(recipe.title)}</title>
                    <style>
                      body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
                      h1 { color: #333; }
                      .section { margin: 20px 0; }
                      .section-title { font-size: 18px; font-weight: bold; color: #555; margin-bottom: 10px; }
                      .ingredient { margin: 5px 0; padding-left: 20px; }
                      .instructions { background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; }
                      .rating { font-size: 16px; color: #ff9800; margin: 10px 0; }
                      .comment { background: #f9f9f9; padding: 10px; margin: 10px 0; border-left: 3px solid #ddd; }
                      .comment-date { font-size: 12px; color: #999; margin-top: 5px; }
                      .no-content { color: #999; font-style: italic; }
                    </style>
                  </head>
                  <body>
                    <h1>${escapeHtml(recipe.title)}</h1>
                    
                    <div class="section">
                      <div class="rating">
                        ${ratingData.avgRating 
                          ? `⭐ ${ratingData.avgRating.toFixed(1)} / 5.0 (${ratingData.count} rating${ratingData.count !== 1 ? 's' : ''})` 
                          : '⭐ No ratings yet'}
                      </div>
                    </div>
                    
                    <div class="section">
                      <div class="section-title">Ingredients:</div>
                      ${ingredients.map(ing => 
                        `<div class="ingredient">• ${escapeHtml(ing.ingredient)}</div>`
                      ).join('')}
                    </div>
                    
                    <div class="section">
                      <div class="section-title">Instructions:</div>
                      <div class="instructions">${escapeHtml(recipe.instructions)}</div>
                    </div>
                    
                    <div class="section">
                      <div class="section-title">Comments (${comments.length}):</div>
                      ${comments.length > 0 
                        ? comments.map(comment => `
                            <div class="comment">
                              <div>${escapeHtml(comment.comment)}</div>
                              <div class="comment-date">${new Date(comment.created_at).toLocaleString()}</div>
                            </div>
                          `).join('')
                        : '<p class="no-content">No comments yet.</p>'}
                    </div>
                  </body>
                  </html>`;
                  
                  res.status(200).type('text/html').send(html);
                }
              );
            }
          );
        }
      );
    }
  );
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;
  
  // Validate input
  if (!comment) {
    return res.status(400).json({ error: 'Comment is required' });
  }
  
  if (typeof comment !== 'string' || comment.trim().length === 0) {
    return res.status(400).json({ error: 'Comment must be a non-empty string' });
  }
  
  // Validate UUID format
  if (!isValidUUID(recipeId)) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  
  // Check if recipe exists
  db.get(
    'SELECT id FROM recipes WHERE id = ?',
    [recipeId],
    (err, recipe) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      // Add comment
      db.run(
        'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
        [recipeId, comment.trim()],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(400).json({ error: 'Invalid input' });
          }
          
          res.status(201).json({ message: 'Comment added successfully' });
        }
      );
    }
  );
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;
  
  // Validate input
  if (rating === undefined || rating === null) {
    return res.status(400).json({ error: 'Rating is required' });
  }
  
  // Check if rating is an integer and within range
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }
  
  // Validate UUID format
  if (!isValidUUID(recipeId)) {
    return res.status(404).json({ error: 'Recipe not found' });
  }
  
  // Check if recipe exists
  db.get(
    'SELECT id FROM recipes WHERE id = ?',
    [recipeId],
    (err, recipe) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      // Add rating
      db.run(
        'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
        [recipeId, rating],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(400).json({ error: 'Invalid input' });
          }
          
          res.status(201).json({ message: 'Rating added successfully' });
        }
      );
    }
  );
});

// Helper function to escape HTML to prevent XSS
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Helper function to validate UUID v4 format
function isValidUUID(uuid) {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});