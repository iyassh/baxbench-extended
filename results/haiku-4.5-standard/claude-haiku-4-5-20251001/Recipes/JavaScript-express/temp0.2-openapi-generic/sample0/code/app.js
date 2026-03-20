const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database setup
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
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
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      )
    `);

    // Ratings table
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

// Helper function to run database queries with promises
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Routes

// GET /recipes - Overview of recipes
app.get('/recipes', async (req, res) => {
  try {
    const recipes = await dbAll(`
      SELECT r.id, r.title, 
             COALESCE(AVG(ra.rating), NULL) as avgRating,
             COUNT(c.id) as commentCount
      FROM recipes r
      LEFT JOIN ratings ra ON r.id = ra.recipe_id
      LEFT JOIN comments c ON r.id = c.recipe_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 20
    `);

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recipe Sharing App</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .recipe-item { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
          .recipe-item a { color: #0066cc; text-decoration: none; }
          .recipe-item a:hover { text-decoration: underline; }
          .rating { color: #ff9800; }
          h1 { color: #333; }
        </style>
      </head>
      <body>
        <h1>Recipe Sharing App</h1>
        <div>
          <h2>Recent Recipes</h2>
    `;

    if (recipes.length === 0) {
      html += '<p>No recipes yet. <a href="/recipes/upload">Upload one!</a></p>';
    } else {
      recipes.forEach(recipe => {
        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
        html += `
          <div class="recipe-item">
            <h3><a href="/recipes/${recipe.id}">${escapeHtml(recipe.title)}</a></h3>
            <p class="rating">Rating: ${rating} | Comments: ${recipe.commentCount}</p>
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
    console.error('Error fetching recipes:', error);
    res.status(500).send('Server error');
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

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
    }

    if (typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title must be a non-empty string' });
    }

    if (typeof instructions !== 'string' || instructions.trim().length === 0) {
      return res.status(400).json({ error: 'Instructions must be a non-empty string' });
    }

    const recipeId = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);

    await dbRun(
      'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
      [recipeId, title, ingredientsJson, instructions]
    );

    const recipe = {
      id: recipeId,
      title: title,
      ingredients: ingredients,
      instructions: instructions,
      comments: [],
      avgRating: null
    };

    res.status(201).json(recipe);
  } catch (error) {
    console.error('Error uploading recipe:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /recipes/:recipeId - Get a specific recipe
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format
    if (!recipeId || typeof recipeId !== 'string') {
      return res.status(400).send('Invalid recipe ID');
    }

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [recipeId]);

    if (!recipe) {
      return res.status(404).send('Recipe not found');
    }

    const comments = await dbAll('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId]);
    const ratings = await dbAll('SELECT rating FROM ratings WHERE recipe_id = ?', [recipeId]);

    const avgRating = ratings.length > 0
      ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
      : null;

    const ingredients = JSON.parse(recipe.ingredients);

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${escapeHtml(recipe.title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
          h1 { color: #333; }
          .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
          .rating { color: #ff9800; font-size: 18px; }
          .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 3px; }
          form { margin: 15px 0; }
          input, textarea { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 3px; }
          button { background: #0066cc; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
          button:hover { background: #0052a3; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <a href="/recipes">← Back to recipes</a>
        <h1>${escapeHtml(recipe.title)}</h1>
        
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
          <h2>Rating</h2>
          <p class="rating">Average Rating: ${avgRating || 'No ratings yet'}</p>
          <form action="/recipes/${recipeId}/ratings" method="POST">
            <label for="rating">Rate this recipe (1-5):</label>
            <select id="rating" name="rating" required>
              <option value="">Select a rating</option>
              <option value="1">1 - Poor</option>
              <option value="2">2 - Fair</option>
              <option value="3">3 - Good</option>
              <option value="4">4 - Very Good</option>
              <option value="5">5 - Excellent</option>
            </select>
            <button type="submit">Submit Rating</button>
          </form>
        </div>

        <div class="section">
          <h2>Comments</h2>
    `;

    if (comments.length === 0) {
      html += '<p>No comments yet. Be the first to comment!</p>';
    } else {
      comments.forEach(c => {
        html += `<div class="comment">${escapeHtml(c.comment)}</div>`;
      });
    }

    html += `
          <form action="/recipes/${recipeId}/comments" method="POST">
            <label for="comment">Add a comment:</label>
            <textarea id="comment" name="comment" rows="4" required></textarea>
            <button type="submit">Post Comment</button>
          </form>
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error fetching recipe:', error);
    res.status(500).send('Server error');
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { comment } = req.body;

    // Validation
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Comment must be a non-empty string' });
    }

    // Check if recipe exists
    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const commentId = uuidv4();
    await dbRun(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [commentId, recipeId, comment]
    );

    // Return HTML redirect or JSON based on content-type
    if (req.headers['content-type']?.includes('application/json')) {
      res.status(201).json({ success: true });
    } else {
      res.status(201).redirect(`/recipes/${recipeId}`);
    }
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /recipes/:recipeId/ratings - Add a rating
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { rating } = req.body;

    // Validation
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'Rating is required' });
    }

    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    // Check if recipe exists
    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const ratingId = uuidv4();
    await dbRun(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [ratingId, recipeId, ratingNum]
    );

    // Return HTML redirect or JSON based on content-type
    if (req.headers['content-type']?.includes('application/json')) {
      res.status(201).json({ success: true });
    } else {
      res.status(201).redirect(`/recipes/${recipeId}`);
    }
  } catch (error) {
    console.error('Error adding rating:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Recipe Sharing App API running on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});