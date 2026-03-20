'use strict';

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; object-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// CSRF token middleware (CWE-352)
// For state-changing requests, we require a CSRF token via a custom header
// We use the double-submit cookie pattern
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';

const cookieParser = require('cookie-parser');
app.use(cookieParser());

// Issue CSRF token on GET requests
app.use((req, res, next) => {
  if (!req.cookies[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'Strict' });
    req.csrfToken = token;
  } else {
    req.csrfToken = req.cookies[CSRF_COOKIE];
  }
  next();
});

// CSRF validation for state-changing methods
function csrfProtect(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const headerToken = req.headers[CSRF_HEADER];
    const cookieToken = req.cookies[CSRF_COOKIE];
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
  }
  next();
}

app.use(csrfProtect);

// Initialize SQLite database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Failed to connect to database');
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
    created_at INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);
});

// Helper: escape HTML to prevent XSS (CWE-79)
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Helper: run db query with promise
function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// GET /recipes - Overview of recipes
app.get('/recipes', async (req, res) => {
  try {
    const recentRecipes = await dbAll(
      `SELECT r.id, r.title, AVG(rt.rating) as avgRating
       FROM recipes r
       LEFT JOIN ratings rt ON r.id = rt.recipe_id
       GROUP BY r.id
       ORDER BY r.created_at DESC
       LIMIT 10`,
      []
    );

    const topRatedRecipes = await dbAll(
      `SELECT r.id, r.title, AVG(rt.rating) as avgRating
       FROM recipes r
       LEFT JOIN ratings rt ON r.id = rt.recipe_id
       GROUP BY r.id
       HAVING avgRating IS NOT NULL
       ORDER BY avgRating DESC
       LIMIT 10`,
      []
    );

    const renderRecipeList = (recipes) => {
      if (recipes.length === 0) return '<p>No recipes found.</p>';
      return recipes.map(r => {
        const avg = r.avgRating !== null ? Number(r.avgRating).toFixed(1) : 'Not rated';
        return `<li><a href="/recipes/${escapeHtml(r.id)}">${escapeHtml(r.title)}</a> - Rating: ${escapeHtml(String(avg))}</li>`;
      }).join('');
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recipe Overview</title>
</head>
<body>
  <h1>Recipe Sharing App</h1>
  <h2>Recent Recipes</h2>
  <ul>${renderRecipeList(recentRecipes)}</ul>
  <h2>Top Rated Recipes</h2>
  <ul>${renderRecipeList(topRatedRecipes)}</ul>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    // CWE-209: Don't expose internal error details
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    // Input validation (CWE-20)
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing title' });
    }
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Invalid or missing ingredients' });
    }
    for (const ing of ingredients) {
      if (typeof ing !== 'string' || ing.trim().length === 0) {
        return res.status(400).json({ error: 'Each ingredient must be a non-empty string' });
      }
    }
    if (!instructions || typeof instructions !== 'string' || instructions.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing instructions' });
    }

    // Length limits
    if (title.length > 500) {
      return res.status(400).json({ error: 'Title too long' });
    }
    if (instructions.length > 100000) {
      return res.status(400).json({ error: 'Instructions too long' });
    }
    if (ingredients.length > 500) {
      return res.status(400).json({ error: 'Too many ingredients' });
    }

    const id = uuidv4();
    const createdAt = Date.now();
    const ingredientsJson = JSON.stringify(ingredients.map(i => i.trim()));

    await dbRun(
      `INSERT INTO recipes (id, title, ingredients, instructions, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, title.trim(), ingredientsJson, instructions.trim(), createdAt]
    );

    const recipe = {
      id,
      title: title.trim(),
      ingredients: ingredients.map(i => i.trim()),
      instructions: instructions.trim(),
      comments: [],
      avgRating: null
    };

    res.status(201).json(recipe);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format (UUID)
    if (!/^[0-9a-f-]{36}$/.test(recipeId)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const recipe = await dbGet(`SELECT * FROM recipes WHERE id = ?`, [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const comments = await dbAll(
      `SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at ASC`,
      [recipeId]
    );

    const ratingRow = await dbGet(
      `SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?`,
      [recipeId]
    );

    const avgRating = ratingRow && ratingRow.avgRating !== null ? Number(ratingRow.avgRating).toFixed(1) : null;
    let ingredients;
    try {
      ingredients = JSON.parse(recipe.ingredients);
    } catch (e) {
      ingredients = [];
    }

    const commentsHtml = comments.length === 0
      ? '<p>No comments yet.</p>'
      : comments.map(c => `<li>${escapeHtml(c.comment)}</li>`).join('');

    const ingredientsHtml = ingredients.map(i => `<li>${escapeHtml(i)}</li>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(recipe.title)}</title>
</head>
<body>
  <h1>${escapeHtml(recipe.title)}</h1>
  <h2>Ingredients</h2>
  <ul>${ingredientsHtml}</ul>
  <h2>Instructions</h2>
  <p>${escapeHtml(recipe.instructions)}</p>
  <h2>Rating</h2>
  <p>${avgRating !== null ? escapeHtml(String(avgRating)) + ' / 5' : 'Not rated yet'}</p>
  <h2>Comments</h2>
  <ul>${commentsHtml}</ul>
  <p><a href="/recipes">Back to overview</a></p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format
    if (!/^[0-9a-f-]{36}$/.test(recipeId)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const { comment } = req.body;

    // Input validation (CWE-20)
    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid or missing comment' });
    }
    if (comment.length > 10000) {
      return res.status(400).json({ error: 'Comment too long' });
    }

    const recipe = await dbGet(`SELECT id FROM recipes WHERE id = ?`, [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    const createdAt = Date.now();

    await dbRun(
      `INSERT INTO comments (id, recipe_id, comment, created_at) VALUES (?, ?, ?, ?)`,
      [id, recipeId, comment.trim(), createdAt]
    );

    res.status(201).json({ message: 'Comment added successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate recipeId format
    if (!/^[0-9a-f-]{36}$/.test(recipeId)) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const { rating } = req.body;

    // Input validation (CWE-20)
    if (rating === undefined || rating === null) {
      return res.status(400).json({ error: 'Missing rating' });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    const recipe = await dbGet(`SELECT id FROM recipes WHERE id = ?`, [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    const createdAt = Date.now();

    await dbRun(
      `INSERT INTO ratings (id, recipe_id, rating, created_at) VALUES (?, ?, ?, ?)`,
      [id, recipeId, rating, createdAt]
    );

    res.status(201).json({ message: 'Rating added successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

module.exports = app;