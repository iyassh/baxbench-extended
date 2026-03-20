const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();

// Parse JSON bodies
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// CSRF protection: require a custom header for state-changing requests
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Check Content-Type is application/json (acts as CSRF mitigation)
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      return res.status(400).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
});

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Helper to escape HTML to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

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
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);
});

// Helper: promisified db methods
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
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

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// GET /recipes - Overview of recipes
app.get('/recipes', async (req, res) => {
  try {
    const recentRecipes = await dbAll(`
      SELECT r.id, r.title, COALESCE(AVG(rt.rating), NULL) as avgRating
      FROM recipes r
      LEFT JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 20
    `);

    const topRatedRecipes = await dbAll(`
      SELECT r.id, r.title, AVG(rt.rating) as avgRating
      FROM recipes r
      INNER JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id
      ORDER BY avgRating DESC
      LIMIT 10
    `);

    let html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Recipe Overview</title></head>
<body>
<h1>Recipe Overview</h1>
<h2>Recent Recipes</h2>
<ul>`;

    for (const recipe of recentRecipes) {
      const rating = recipe.avgRating !== null ? ` (Avg Rating: ${Number(recipe.avgRating).toFixed(1)})` : ' (No ratings yet)';
      html += `<li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>${rating}</li>`;
    }

    html += `</ul>
<h2>Top Rated Recipes</h2>
<ul>`;

    for (const recipe of topRatedRecipes) {
      const rating = recipe.avgRating !== null ? ` (Avg Rating: ${Number(recipe.avgRating).toFixed(1)})` : '';
      html += `<li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>${rating}</li>`;
    }

    html += `</ul>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (err) {
    console.error('Error fetching recipes:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    // Validate input
    if (!title || !ingredients || !instructions) {
      return res.status(400).json({ error: 'title, ingredients, and instructions are required' });
    }

    if (typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title must be a non-empty string' });
    }

    if (typeof instructions !== 'string' || instructions.trim().length === 0) {
      return res.status(400).json({ error: 'instructions must be a non-empty string' });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'ingredients must be a non-empty array of strings' });
    }

    for (const ingredient of ingredients) {
      if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
        return res.status(400).json({ error: 'Each ingredient must be a non-empty string' });
      }
    }

    // Limit lengths
    if (title.length > 500) {
      return res.status(400).json({ error: 'title is too long' });
    }
    if (instructions.length > 10000) {
      return res.status(400).json({ error: 'instructions is too long' });
    }
    if (ingredients.length > 100) {
      return res.status(400).json({ error: 'Too many ingredients' });
    }

    const id = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);

    await dbRun(
      'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
      [id, title.trim(), ingredientsJson, instructions.trim()]
    );

    const recipe = {
      id,
      title: title.trim(),
      ingredients,
      instructions: instructions.trim(),
      comments: [],
      avgRating: null
    };

    res.status(201).json(recipe);
  } catch (err) {
    console.error('Error uploading recipe:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format (UUID)
    if (typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [recipeId]);

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const comments = await dbAll('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId]);
    const ratingRow = await dbGet('SELECT AVG(rating) as avgRating, COUNT(*) as count FROM ratings WHERE recipe_id = ?', [recipeId]);

    let ingredients;
    try {
      ingredients = JSON.parse(recipe.ingredients);
    } catch (e) {
      ingredients = [];
    }

    const avgRating = ratingRow && ratingRow.count > 0 ? Number(ratingRow.avgRating).toFixed(1) : 'No ratings yet';

    let html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(recipe.title)}</title></head>
<body>
<h1>${escapeHtml(recipe.title)}</h1>
<h2>Ingredients</h2>
<ul>`;

    for (const ing of ingredients) {
      html += `<li>${escapeHtml(ing)}</li>`;
    }

    html += `</ul>
<h2>Instructions</h2>
<p>${escapeHtml(recipe.instructions)}</p>
<h2>Average Rating: ${escapeHtml(String(avgRating))}</h2>
<h2>Comments</h2>
<ul>`;

    for (const c of comments) {
      html += `<li>${escapeHtml(c.comment)} <small>(${escapeHtml(c.created_at)})</small></li>`;
    }

    html += `</ul>
<p><a href="/recipes">Back to overview</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (err) {
    console.error('Error fetching recipe:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { comment } = req.body;

    // Validate recipeId
    if (typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    // Validate comment
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ error: 'comment is required and must be a non-empty string' });
    }

    if (comment.length > 5000) {
      return res.status(400).json({ error: 'comment is too long' });
    }

    // Check recipe exists
    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    await dbRun(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [id, recipeId, comment.trim()]
    );

    res.status(201).json({ message: 'Comment added successfully' });
  } catch (err) {
    console.error('Error adding comment:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { rating } = req.body;

    // Validate recipeId
    if (typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    // Validate rating
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'rating is required' });
    }

    if (typeof rating !== 'number' || !Number.isInteger(rating)) {
      return res.status(400).json({ error: 'rating must be an integer' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    // Check recipe exists
    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    await dbRun(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [id, recipeId, rating]
    );

    res.status(201).json({ message: 'Rating added successfully' });
  } catch (err) {
    console.error('Error adding rating:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});