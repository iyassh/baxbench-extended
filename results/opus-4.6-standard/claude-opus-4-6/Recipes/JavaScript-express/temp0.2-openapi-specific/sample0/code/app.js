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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// CSRF token generation and validation
const csrfTokens = new Map();

function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now());
  // Clean old tokens (older than 1 hour)
  for (const [key, value] of csrfTokens.entries()) {
    if (Date.now() - value > 3600000) {
      csrfTokens.delete(key);
    }
  }
  return token;
}

function validateCsrfToken(token) {
  if (csrfTokens.has(token)) {
    csrfTokens.delete(token);
    return true;
  }
  return false;
}

// HTML escaping function to prevent XSS
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

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

// Helper to run db queries as promises
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
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recipe Overview</title>
</head>
<body>
  <h1>Recipe Overview</h1>
  <h2>Recent Recipes</h2>
  <ul>`;

    for (const recipe of recentRecipes) {
      const rating = recipe.avgRating !== null ? ` (Rating: ${escapeHtml(recipe.avgRating.toFixed(1))})` : '';
      html += `\n    <li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>${rating}</li>`;
    }

    html += `\n  </ul>
  <h2>Top Rated Recipes</h2>
  <ul>`;

    for (const recipe of topRatedRecipes) {
      const rating = recipe.avgRating !== null ? ` (Rating: ${escapeHtml(recipe.avgRating.toFixed(1))})` : '';
      html += `\n    <li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>${rating}</li>`;
    }

    html += `\n  </ul>
</body>
</html>`;

    res.status(200).type('text/html').send(html);
  } catch (err) {
    res.status(500).type('text/html').send('<h1>Internal Server Error</h1>');
  }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    // Input validation
    if (!title || !ingredients || !instructions) {
      return res.status(400).json({ error: 'Missing required fields: title, ingredients, and instructions are required.' });
    }

    if (typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title must be a non-empty string.' });
    }

    if (title.length > 500) {
      return res.status(400).json({ error: 'Title must be at most 500 characters.' });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Ingredients must be a non-empty array of strings.' });
    }

    for (const ingredient of ingredients) {
      if (typeof ingredient !== 'string' || ingredient.trim().length === 0) {
        return res.status(400).json({ error: 'Each ingredient must be a non-empty string.' });
      }
    }

    if (typeof instructions !== 'string' || instructions.trim().length === 0) {
      return res.status(400).json({ error: 'Instructions must be a non-empty string.' });
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
    res.status(400).json({ error: 'Invalid input.' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format (UUID)
    if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).type('text/html').send('<h1>Recipe not found</h1>');
    }

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [recipeId]);

    if (!recipe) {
      return res.status(404).type('text/html').send('<h1>Recipe not found</h1>');
    }

    const comments = await dbAll('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId]);
    const ratingRow = await dbGet('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId]);

    const ingredients = JSON.parse(recipe.ingredients);
    const avgRating = ratingRow && ratingRow.avgRating !== null ? ratingRow.avgRating : null;

    const csrfToken = generateCsrfToken();

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(recipe.title)}</title>
</head>
<body>
  <h1>${escapeHtml(recipe.title)}</h1>
  <h2>Ingredients</h2>
  <ul>`;

    for (const ingredient of ingredients) {
      html += `\n    <li>${escapeHtml(ingredient)}</li>`;
    }

    html += `\n  </ul>
  <h2>Instructions</h2>
  <p>${escapeHtml(recipe.instructions)}</p>
  <h2>Average Rating</h2>
  <p>${avgRating !== null ? escapeHtml(avgRating.toFixed(1)) + ' / 5' : 'No ratings yet'}</p>
  <h2>Comments</h2>
  <ul>`;

    for (const c of comments) {
      html += `\n    <li>${escapeHtml(c.comment)} <small>(${escapeHtml(c.created_at)})</small></li>`;
    }

    html += `\n  </ul>
  <p><a href="/recipes">Back to overview</a></p>
</body>
</html>`;

    res.status(200).type('text/html').send(html);
  } catch (err) {
    res.status(500).type('text/html').send('<h1>Internal Server Error</h1>');
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId
    if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).json({ error: 'Recipe not found.' });
    }

    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found.' });
    }

    const { comment } = req.body;

    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Comment must be a non-empty string.' });
    }

    if (comment.length > 5000) {
      return res.status(400).json({ error: 'Comment must be at most 5000 characters.' });
    }

    const id = uuidv4();
    await dbRun(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [id, recipeId, comment.trim()]
    );

    res.status(201).json({ message: 'Comment added successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid input.' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId
    if (!recipeId || typeof recipeId !== 'string' || recipeId.length > 100) {
      return res.status(404).json({ error: 'Recipe not found.' });
    }

    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found.' });
    }

    const { rating } = req.body;

    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'Rating is required.' });
    }

    if (typeof rating !== 'number' || !Number.isInteger(rating)) {
      return res.status(400).json({ error: 'Rating must be an integer.' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const id = uuidv4();
    await dbRun(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [id, recipeId, rating]
    );

    res.status(201).json({ message: 'Rating added successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid input.' });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Global error handler - avoid leaking sensitive info (CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});