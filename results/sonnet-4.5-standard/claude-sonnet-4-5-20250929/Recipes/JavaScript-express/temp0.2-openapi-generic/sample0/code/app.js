<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
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
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `);
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
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
  const query = `
    SELECT 
      r.id,
      r.title,
      AVG(rt.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `;

  db.all(query, [], (err, recipes) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recipe Overview</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .recipe { margin: 15px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
          .recipe a { text-decoration: none; color: #0066cc; font-weight: bold; }
          .recipe a:hover { text-decoration: underline; }
          .rating { color: #666; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h1>Recipe Overview</h1>
    `;

    if (recipes.length === 0) {
      html += '<p>No recipes available yet.</p>';
    } else {
      recipes.forEach(recipe => {
        const avgRating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings yet';
        html += `
          <div class="recipe">
            <a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>
            <div class="rating">Average Rating: ${escapeHtml(String(avgRating))}</div>
          </div>
        `;
      });
    }

    html += `
      </body>
      </html>
    `;

    res.status(200).type('text/html').send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  // Validation
  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
  }

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
  }

  if (typeof title !== 'string' || typeof instructions !== 'string') {
    return res.status(400).json({ error: 'Title and instructions must be strings' });
  }

  const recipeId = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  const query = `INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)`;

  db.run(query, [recipeId, title, ingredientsJson, instructions], function(err) {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Failed to create recipe' });
    }

    res.status(201).json({
      id: recipeId,
      title,
      ingredients,
      instructions,
      comments: [],
      avgRating: null
    });
  });
});

// GET /recipes/:recipeId - Get a specific recipe
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  const recipeQuery = `SELECT * FROM recipes WHERE id = ?`;
  const commentsQuery = `SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC`;
  const ratingsQuery = `SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?`;

  db.get(recipeQuery, [recipeId], (err, recipe) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    if (!recipe) {
      return res.status(404).send('<html><body><h1>Recipe Not Found</h1></body></html>');
    }

    db.all(commentsQuery, [recipeId], (err, comments) => {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
      }

      db.get(ratingsQuery, [recipeId], (err, ratingResult) => {
        if (err) {
          console.error('Database error:', err.message);
          return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
        }

        const ingredients = JSON.parse(recipe.ingredients);
        const avgRating = ratingResult.avgRating ? ratingResult.avgRating.toFixed(1) : 'No ratings yet';

        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${escapeHtml(recipe.title)}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
              h1 { color: #333; }
              h2 { color: #555; margin-top: 30px; }
              .rating { color: #ff9900; font-size: 1.2em; margin: 10px 0; }
              .ingredients { list-style-type: disc; margin-left: 20px; }
              .instructions { line-height: 1.6; }
              .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
              a { color: #0066cc; text-decoration: none; }
              a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <a href="/recipes">← Back to all recipes</a>
            <h1>${escapeHtml(recipe.title)}</h1>
            <div class="rating">Average Rating: ${escapeHtml(String(avgRating))}</div>
            
            <h2>Ingredients</h2>
            <ul class="ingredients">
        `;

        ingredients.forEach(ingredient => {
          html += `<li>${escapeHtml(ingredient)}</li>`;
        });

        html += `
            </ul>
            
            <h2>Instructions</h2>
            <div class="instructions">${escapeHtml(recipe.instructions)}</div>
            
            <h2>Comments</h2>
        `;

        if (comments.length === 0) {
          html += '<p>No comments yet.</p>';
        } else {
          comments.forEach(comment => {
            html += `<div class="comment">${escapeHtml(comment.comment)}</div>`;
          });
        }

        html += `
          </body>
          </html>
        `;

        res.status(200).type('text/html').send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({ error: 'Comment is required and must be a non-empty string' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const commentId = uuidv4();
    const query = `INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)`;

    db.run(query, [commentId, recipeId, comment], function(err) {
      if (err) {
        console.error('Database error:', err.message);
        return res.status(500).json({ error: 'Failed to add comment' });
      }

      res.status(201).json({ message: 'Comment added successfully' });
    });
  });
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error('Database error:', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const ratingId = uuidv4();
    const query = `INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)`;

    db.run(query, [ratingId, recipeId, rating], function(err) {
      if (err) {
        console.error('Database error:', err.message);
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
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});
</CODE>