const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('db.sqlite3');

// Initialize database tables
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
    rating INTEGER NOT NULL,
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
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// GET /recipes - Overview of recipes
app.get('/recipes', async (req, res) => {
  try {
    const recipes = await dbAll(`
      SELECT r.id, r.title, AVG(rt.rating) as avgRating
      FROM recipes r
      LEFT JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `);

    let html = `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipes</h1>
<h2>Recent Recipes</h2>
<ul>`;

    for (const recipe of recipes) {
      const ratingDisplay = recipe.avgRating !== null ? ` (Avg Rating: ${recipe.avgRating.toFixed(1)})` : ' (No ratings yet)';
      html += `<li><a href="/recipes/${recipe.id}">${recipe.title}</a>${ratingDisplay}</li>`;
    }

    html += `</ul>
<h2>Top Rated Recipes</h2>
<ul>`;

    const topRated = [...recipes].filter(r => r.avgRating !== null).sort((a, b) => b.avgRating - a.avgRating);
    for (const recipe of topRated) {
      html += `<li><a href="/recipes/${recipe.id}">${recipe.title}</a> (Avg Rating: ${recipe.avgRating.toFixed(1)})</li>`;
    }

    html += `</ul>
</body>
</html>`;

    res.status(200).type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', async (req, res) => {
  try {
    const { title, ingredients, instructions } = req.body;

    if (!title || !ingredients || !instructions) {
      return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
    }

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
    }

    if (typeof title !== 'string' || typeof instructions !== 'string') {
      return res.status(400).json({ error: 'Title and instructions must be strings' });
    }

    const id = uuidv4();
    const ingredientsJson = JSON.stringify(ingredients);

    await dbRun(
      'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
      [id, title, ingredientsJson, instructions]
    );

    const recipe = {
      id,
      title,
      ingredients,
      instructions,
      comments: [],
      avgRating: null
    };

    res.status(201).json(recipe);
  } catch (err) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const { recipeId } = req.params;

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const comments = await dbAll('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId]);
    const ratingRow = await dbGet('SELECT AVG(rating) as avgRating, COUNT(*) as count FROM ratings WHERE recipe_id = ?', [recipeId]);

    const ingredients = JSON.parse(recipe.ingredients);
    const avgRating = ratingRow && ratingRow.count > 0 ? ratingRow.avgRating : null;

    let html = `<!DOCTYPE html>
<html>
<head><title>${recipe.title}</title></head>
<body>
<h1>${recipe.title}</h1>
<h2>Ingredients</h2>
<ul>`;

    for (const ing of ingredients) {
      html += `<li>${ing}</li>`;
    }

    html += `</ul>
<h2>Instructions</h2>
<p>${recipe.instructions}</p>
<h2>Rating</h2>
<p>${avgRating !== null ? `Average Rating: ${avgRating.toFixed(1)}` : 'No ratings yet'}</p>
<h2>Comments</h2>
<ul>`;

    for (const c of comments) {
      html += `<li>${c.comment}</li>`;
    }

    if (comments.length === 0) {
      html += `<li>No comments yet</li>`;
    }

    html += `</ul>
<p><a href="/recipes">Back to all recipes</a></p>
</body>
</html>`;

    res.status(200).type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { comment } = req.body;

    if (!comment || typeof comment !== 'string') {
      return res.status(400).json({ error: 'Invalid input: comment is required and must be a string' });
    }

    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    await dbRun('INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)', [id, recipeId, comment]);

    res.status(201).json({ message: 'Comment added successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const { recipeId } = req.params;
    const { rating } = req.body;

    if (rating === undefined || rating === null || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid input: rating must be an integer between 1 and 5' });
    }

    const recipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [recipeId]);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    await dbRun('INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)', [id, recipeId, rating]);

    res.status(201).json({ message: 'Rating added successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Recipe Sharing App API running on http://0.0.0.0:5000');
});