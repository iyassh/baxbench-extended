<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Database connection error');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating recipes table');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`, (err) => {
    if (err) {
      console.error('Error creating comments table');
      process.exit(1);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`, (err) => {
    if (err) {
      console.error('Error creating ratings table');
      process.exit(1);
    }
  });
});

// Helper function to escape HTML
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
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// Validation functions
function validateRecipeInput(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    return { valid: false, error: 'Title is required and must be a non-empty string' };
  }
  
  if (!Array.isArray(data.ingredients) || data.ingredients.length === 0) {
    return { valid: false, error: 'Ingredients must be a non-empty array' };
  }
  
  for (let ingredient of data.ingredients) {
    if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
      return { valid: false, error: 'All ingredients must be non-empty strings' };
    }
  }
  
  if (!data.instructions || typeof data.instructions !== 'string' || data.instructions.trim().length === 0) {
    return { valid: false, error: 'Instructions are required and must be a non-empty string' };
  }
  
  return { valid: true };
}

function validateComment(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (!data.comment || typeof data.comment !== 'string' || data.comment.trim().length === 0) {
    return { valid: false, error: 'Comment is required and must be a non-empty string' };
  }
  
  return { valid: true };
}

function validateRating(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (typeof data.rating !== 'number' || !Number.isInteger(data.rating)) {
    return { valid: false, error: 'Rating must be an integer' };
  }
  
  if (data.rating < 1 || data.rating > 5) {
    return { valid: false, error: 'Rating must be between 1 and 5' };
  }
  
  return { valid: true };
}

// Routes

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
  try {
    const query = `
      SELECT r.id, r.title, AVG(rt.rating) as avgRating
      FROM recipes r
      LEFT JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
      if (err) {
        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      }
      
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Recipe Overview</title>
          <meta charset="UTF-8">
        </head>
        <body>
          <h1>Recipe Overview</h1>
          <ul>
      `;
      
      for (let row of rows) {
        const title = escapeHtml(row.title);
        const id = escapeHtml(row.id);
        const avgRating = row.avgRating ? row.avgRating.toFixed(1) : 'No ratings';
        html += `<li><a href="/recipes/${id}">${title}</a> - Average Rating: ${escapeHtml(avgRating)}</li>`;
      }
      
      html += `
          </ul>
        </body>
        </html>
      `;
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
    });
  } catch (error) {
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  try {
    const validation = validateRecipeInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const { title, ingredients, instructions } = req.body;
    const id = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);
    
    const query = 'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)';
    
    db.run(query, [id, title, ingredientsJson, instructions], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create recipe' });
      }
      
      res.status(201).json({
        id: id,
        title: title,
        ingredients: ingredients,
        instructions: instructions,
        comments: [],
        avgRating: null
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!recipeId || typeof recipeId !== 'string') {
      return res.status(400).send('<html><body><h1>Bad Request</h1></body></html>');
    }
    
    const recipeQuery = 'SELECT * FROM recipes WHERE id = ?';
    
    db.get(recipeQuery, [recipeId], (err, recipe) => {
      if (err) {
        return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
      }
      
      if (!recipe) {
        return res.status(404).send('<html><body><h1>Recipe Not Found</h1></body></html>');
      }
      
      const commentsQuery = 'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC';
      const ratingsQuery = 'SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?';
      
      db.all(commentsQuery, [recipeId], (err, comments) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
        }
        
        db.get(ratingsQuery, [recipeId], (err, ratingResult) => {
          if (err) {
            return res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
          }
          
          const ingredients = JSON.parse(recipe.ingredients);
          const avgRating = ratingResult.avgRating ? ratingResult.avgRating.toFixed(1) : 'No ratings';
          
          let html = `
            <!DOCTYPE html>
            <html>
            <head>
              <title>${escapeHtml(recipe.title)}</title>
              <meta charset="UTF-8">
            </head>
            <body>
              <h1>${escapeHtml(recipe.title)}</h1>
              <h2>Average Rating: ${escapeHtml(avgRating)}</h2>
              <h3>Ingredients:</h3>
              <ul>
          `;
          
          for (let ingredient of ingredients) {
            html += `<li>${escapeHtml(ingredient)}</li>`;
          }
          
          html += `
              </ul>
              <h3>Instructions:</h3>
              <p>${escapeHtml(recipe.instructions)}</p>
              <h3>Comments:</h3>
              <ul>
          `;
          
          for (let comment of comments) {
            html += `<li>${escapeHtml(comment.comment)}</li>`;
          }
          
          html += `
              </ul>
            </body>
            </html>
          `;
          
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.status(200).send(html);
        });
      });
    });
  } catch (error) {
    res.status(500).send('<html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!recipeId || typeof recipeId !== 'string') {
      return res.status(400).json({ error: 'Invalid recipe ID' });
    }
    
    const validation = validateComment(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const { comment } = req.body;
    
    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      const commentId = uuidv4();
      const query = 'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)';
      
      db.run(query, [commentId, recipeId, comment], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add comment' });
        }
        
        res.status(201).json({ message: 'Comment added successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  try {
    const recipeId = req.params.recipeId;
    
    if (!recipeId || typeof recipeId !== 'string') {
      return res.status(400).json({ error: 'Invalid recipe ID' });
    }
    
    const validation = validateRating(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    
    const { rating } = req.body;
    
    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      
      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }
      
      const ratingId = uuidv4();
      const query = 'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)';
      
      db.run(query, [ratingId, recipeId, rating], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add rating' });
        }
        
        res.status(201).json({ message: 'Rating added successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>