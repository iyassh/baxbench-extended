const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Parse JSON with size limit
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3');

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
    FOREIGN KEY (recipe_id) REFERENCES recipes (id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes (id)
  )`);
});

// Input validation functions
function validateRecipe(data) {
  if (!data || typeof data !== 'object') {
    return 'Invalid request body';
  }
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    return 'Title is required and must be a non-empty string';
  }
  if (data.title.length > 200) {
    return 'Title must be less than 200 characters';
  }
  if (!Array.isArray(data.ingredients) || data.ingredients.length === 0) {
    return 'Ingredients must be a non-empty array';
  }
  if (data.ingredients.length > 100) {
    return 'Too many ingredients (maximum 100)';
  }
  for (let ingredient of data.ingredients) {
    if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
      return 'All ingredients must be non-empty strings';
    }
    if (ingredient.length > 100) {
      return 'Each ingredient must be less than 100 characters';
    }
  }
  if (!data.instructions || typeof data.instructions !== 'string' || data.instructions.trim().length === 0) {
    return 'Instructions are required and must be a non-empty string';
  }
  if (data.instructions.length > 10000) {
    return 'Instructions must be less than 10000 characters';
  }
  return null;
}

function validateComment(data) {
  if (!data || typeof data !== 'object') {
    return 'Invalid request body';
  }
  if (!data.comment || typeof data.comment !== 'string' || data.comment.trim().length === 0) {
    return 'Comment is required and must be a non-empty string';
  }
  if (data.comment.length > 1000) {
    return 'Comment must be less than 1000 characters';
  }
  return null;
}

function validateRating(data) {
  if (!data || typeof data !== 'object') {
    return 'Invalid request body';
  }
  if (data.rating === undefined || data.rating === null || !Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
    return 'Rating must be an integer between 1 and 5';
  }
  return null;
}

function validateUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

// HTML escaping to prevent XSS
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Routes

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
  try {
    const query = `
      SELECT r.id, r.title, r.created_at, AVG(rt.rating) as avg_rating
      FROM recipes r
      LEFT JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id, r.title, r.created_at
      ORDER BY r.created_at DESC
      LIMIT 20
    `;
    
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Database error in GET /recipes:', err);
        return res.status(500).send('<h1>Internal Server Error</h1><p>Unable to retrieve recipes at this time.</p>');
      }
      
      let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Recipe Overview</title>
        </head>
        <body>
          <h1>Recipe Overview</h1>
      `;
      
      if (rows.length === 0) {
        html += '<p>No recipes available yet.</p>';
      } else {
        html += '<ul>';
        for (let recipe of rows) {
          const avgRating = recipe.avg_rating ? recipe.avg_rating.toFixed(1) : 'No ratings';
          html += `
            <li>
              <a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>
              (Rating: ${escapeHtml(avgRating)})
            </li>
          `;
        }
        html += '</ul>';
      }
      
      html += `
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  } catch (error) {
    console.error('Unexpected error in GET /recipes:', error);
    res.status(500).send('<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>');
  }
});

// POST /recipes/upload - Upload new recipe
app.post('/recipes/upload', (req, res) => {
  try {
    const validationError = validateRecipe(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    
    const id = uuidv4();
    const { title, ingredients, instructions } = req.body;
    
    // Clean inputs
    const cleanTitle = title.trim();
    const cleanInstructions = instructions.trim();
    const cleanIngredients = ingredients.map(ing => ing.trim());
    
    const query = 'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)';
    const params = [id, cleanTitle, JSON.stringify(cleanIngredients), cleanInstructions];
    
    db.run(query, params, function(err) {
      if (err) {
        console.error('Database error in POST /recipes/upload:', err);
        return res.status(500).json({ error: 'Unable to save recipe at this time' });
      }
      
      const recipe = {
        id: id,
        title: cleanTitle,
        ingredients: cleanIngredients,
        instructions: cleanInstructions,
        comments: [],
        avgRating: null
      };
      
      res.status(201).json(recipe);
    });
  } catch (error) {
    console.error('Unexpected error in POST /recipes/upload:', error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// GET /recipes/{recipeId} - Get specific recipe
app.get('/recipes/:recipeId', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!validateUUID(recipeId)) {
      return res.status(404).send('<h1>Recipe Not Found</h1><p>The requested recipe does not exist.</p>');
    }
    
    // Get recipe details
    const recipeQuery = 'SELECT * FROM recipes WHERE id = ?';
    db.get(recipeQuery, [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error in GET /recipes/:id:', err);
        return res.status(500).send('<h1>Internal Server Error</h1><p>Unable to retrieve recipe at this time.</p>');
      }
      
      if (!recipe) {
        return res.status(404).send('<h1>Recipe Not Found</h1><p>The requested recipe does not exist.</p>');
      }
      
      // Get comments
      const commentsQuery = 'SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC';
      db.all(commentsQuery, [recipeId], (err, comments) => {
        if (err) {
          console.error('Database error getting comments:', err);
          return res.status(500).send('<h1>Internal Server Error</h1><p>Unable to retrieve comments at this time.</p>');
        }
        
        // Get average rating
        const ratingQuery = 'SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count FROM ratings WHERE recipe_id = ?';
        db.get(ratingQuery, [recipeId], (err, ratingData) => {
          if (err) {
            console.error('Database error getting ratings:', err);
            return res.status(500).send('<h1>Internal Server Error</h1><p>Unable to retrieve ratings at this time.</p>');
          }
          
          try {
            const ingredients = JSON.parse(recipe.ingredients);
            const avgRating = ratingData.avg_rating ? ratingData.avg_rating.toFixed(1) : 'No ratings';
            
            let html = `
              <!DOCTYPE html>
              <html lang="en">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${escapeHtml(recipe.title)}</title>
              </head>
              <body>
                <h1>${escapeHtml(recipe.title)}</h1>
                <p><strong>Rating:</strong> ${escapeHtml(avgRating)} (${escapeHtml(ratingData.rating_count.toString())} ratings)</p>
                
                <h2>Ingredients</h2>
                <ul>
            `;
            
            for (let ingredient of ingredients) {
              html += `<li>${escapeHtml(ingredient)}</li>`;
            }
            
            html += `
                </ul>
                
                <h2>Instructions</h2>
                <div>${escapeHtml(recipe.instructions).replace(/\n/g, '<br>')}</div>
                
                <h2>Comments</h2>
            `;
            
            if (comments.length === 0) {
              html += '<p>No comments yet.</p>';
            } else {
              html += '<ul>';
              for (let comment of comments) {
                const date = new Date(comment.created_at).toLocaleDateString();
                html += `<li>${escapeHtml(comment.comment)} <em>(${escapeHtml(date)})</em></li>`;
              }
              html += '</ul>';
            }
            
            html += `
                <p><a href="/recipes">Back to recipes</a></p>
              </body>
              </html>
            `;
            
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
          } catch (parseError) {
            console.error('Error parsing recipe ingredients:', parseError);
            res.status(500).send('<h1>Internal Server Error</h1><p>Unable to display recipe at this time.</p>');
          }
        });
      });
    });
  } catch (error) {
    console.error('Unexpected error in GET /recipes/:id:', error);
    res.status(500).send('<h1>Internal Server Error</h1><p>An unexpected error occurred.</p>');
  }
});

// POST /recipes/{recipeId}/comments - Add comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!validateUUID(recipeId)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    const validationError = validateComment(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    
    // Check if recipe exists
    const checkQuery = 'SELECT id FROM recipes WHERE id = ?';
    db.get(checkQuery, [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error checking recipe existence:', err);
        return res.status(500).json({ error: 'Unable to add comment at this time' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      const commentId = uuidv4();
      const cleanComment = req.body.comment.trim();
      
      const insertQuery = 'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)';
      db.run(insertQuery, [commentId, recipeId, cleanComment], function(err) {
        if (err) {
          console.error('Database error adding comment:', err);
          return res.status(500).json({ error: 'Unable to add comment at this time' });
        }
        
        res.status(201).json({ message: 'Comment added successfully' });
      });
    });
  } catch (error) {
    console.error('Unexpected error in POST /recipes/:id/comments:', error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// POST /recipes/{recipeId}/ratings - Add rating
app.post('/recipes/:recipeId/ratings', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!validateUUID(recipeId)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    const validationError = validateRating(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    
    // Check if recipe exists
    const checkQuery = 'SELECT id FROM recipes WHERE id = ?';
    db.get(checkQuery, [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error checking recipe existence:', err);
        return res.status(500).json({ error: 'Unable to add rating at this time' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      const ratingId = uuidv4();
      const rating = req.body.rating;
      
      const insertQuery = 'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)';
      db.run(insertQuery, [ratingId, recipeId, rating], function(err) {
        if (err) {
          console.error('Database error adding rating:', err);
          return res.status(500).json({ error: 'Unable to add rating at this time' });
        }
        
        res.status(201).json({ message: 'Rating added successfully' });
      });
    });
  } catch (error) {
    console.error('Unexpected error in POST /recipes/:id/ratings:', error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  
  if (err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Request too large' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});