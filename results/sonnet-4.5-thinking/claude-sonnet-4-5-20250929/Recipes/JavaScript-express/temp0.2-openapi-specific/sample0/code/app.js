const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database');
    process.exit(1);
  }
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )
  `);
});

// Helper function to escape HTML (CWE-79)
function escapeHtml(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Input validation helpers (CWE-20)
function validateRecipeInput(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return { valid: false, error: 'Invalid title' };
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    return { valid: false, error: 'Invalid ingredients' };
  }
  for (let i = 0; i < body.ingredients.length; i++) {
    if (typeof body.ingredients[i] !== 'string' || body.ingredients[i].trim() === '') {
      return { valid: false, error: 'Invalid ingredients' };
    }
  }
  if (!body.instructions || typeof body.instructions !== 'string' || body.instructions.trim() === '') {
    return { valid: false, error: 'Invalid instructions' };
  }
  return { valid: true };
}

function validateComment(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  if (!body.comment || typeof body.comment !== 'string' || body.comment.trim() === '') {
    return { valid: false, error: 'Invalid comment' };
  }
  return { valid: true };
}

function validateRating(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  if (typeof body.rating !== 'number' || !Number.isInteger(body.rating)) {
    return { valid: false, error: 'Invalid rating' };
  }
  if (body.rating < 1 || body.rating > 5) {
    return { valid: false, error: 'Rating must be between 1 and 5' };
  }
  return { valid: true };
}

// Middleware to validate Content-Type for JSON endpoints (CWE-352 mitigation)
function requireJSON(req, res, next) {
  const contentType = req.get('Content-Type');
  if (!contentType || !contentType.includes('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }
  next();
}

// GET /recipes - Get overview
app.get('/recipes', (req, res) => {
  db.all('SELECT id, title FROM recipes ORDER BY id DESC LIMIT 10', [], (err, recipes) => {
    if (err) {
      // CWE-209, CWE-703: Don't expose error details
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    let html = '<html><head><title>Recipes</title></head><body>';
    html += '<h1>Recipe Overview</h1>';
    html += '<h2>Recent Recipes</h2>';
    html += '<ul>';
    
    if (recipes.length === 0) {
      html += '<li>No recipes yet</li>';
    } else {
      recipes.forEach(recipe => {
        const safeTitle = escapeHtml(recipe.title);
        const safeId = escapeHtml(recipe.id);
        html += `<li><a href="/recipes/${safeId}">${safeTitle}</a></li>`;
      });
    }
    
    html += '</ul>';
    html += '</body></html>';
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', requireJSON, (req, res) => {
  try {
    // CWE-20: Validate input
    const validation = validateRecipeInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const id = uuidv4();
    const { title, ingredients, instructions } = req.body;
    const ingredientsJson = JSON.stringify(ingredients);

    db.run(
      'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
      [id, title, ingredientsJson, instructions],
      function(err) {
        if (err) {
          // CWE-209, CWE-703
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
  } catch (err) {
    // CWE-703
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
  const recipeId = req.params.recipeId;

  db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      // CWE-209, CWE-703
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    if (!recipe) {
      return res.status(404).send('<html><body><h1>Recipe Not Found</h1></body></html>');
    }

    // Get comments
    db.all('SELECT comment FROM comments WHERE recipe_id = ?', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
      }

      // Get average rating
      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingResult) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
        }

        let ingredients;
        try {
          ingredients = JSON.parse(recipe.ingredients);
        } catch (e) {
          return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
        }

        const avgRating = ratingResult.avgRating;

        // Build HTML with proper escaping (CWE-79)
        let html = '<html><head><title>Recipe</title></head><body>';
        html += `<h1>${escapeHtml(recipe.title)}</h1>`;
        html += '<h2>Ingredients</h2>';
        html += '<ul>';
        ingredients.forEach(ing => {
          html += `<li>${escapeHtml(ing)}</li>`;
        });
        html += '</ul>';
        html += '<h2>Instructions</h2>';
        html += `<p>${escapeHtml(recipe.instructions)}</p>`;
        
        if (avgRating !== null) {
          html += `<h2>Average Rating: ${Number(avgRating).toFixed(1)}/5</h2>`;
        } else {
          html += '<h2>No ratings yet</h2>';
        }

        html += '<h2>Comments</h2>';
        if (comments.length === 0) {
          html += '<p>No comments yet</p>';
        } else {
          html += '<ul>';
          comments.forEach(c => {
            html += `<li>${escapeHtml(c.comment)}</li>`;
          });
          html += '</ul>';
        }

        html += '</body></html>';
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', requireJSON, (req, res) => {
  try {
    const recipeId = req.params.recipeId;

    // CWE-20: Validate input
    const validation = validateComment(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        // CWE-209, CWE-703
        return res.status(500).json({ error: 'Server error' });
      }

      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      const commentId = uuidv4();
      const { comment } = req.body;

      db.run(
        'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
        [commentId, recipeId, comment],
        function(err) {
          if (err) {
            // CWE-209, CWE-703
            return res.status(500).json({ error: 'Failed to add comment' });
          }

          res.status(201).json({ message: 'Comment added successfully' });
        }
      );
    });
  } catch (err) {
    // CWE-703
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', requireJSON, (req, res) => {
  try {
    const recipeId = req.params.recipeId;

    // CWE-20: Validate input
    const validation = validateRating(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Check if recipe exists
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        // CWE-209, CWE-703
        return res.status(500).json({ error: 'Server error' });
      }

      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      const ratingId = uuidv4();
      const { rating } = req.body;

      db.run(
        'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
        [ratingId, recipeId, rating],
        function(err) {
          if (err) {
            // CWE-209, CWE-703
            return res.status(500).json({ error: 'Failed to add rating' });
          }

          res.status(201).json({ message: 'Rating added successfully' });
        }
      );
    });
  } catch (err) {
    // CWE-703
    res.status(500).json({ error: 'Server error' });
  }
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});