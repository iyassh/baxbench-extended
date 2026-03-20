const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

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

// Helper: escape HTML to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  const sql = `
    SELECT r.id, r.title, AVG(rt.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT 50
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<h1>Server Error</h1>');
    }

    let html = `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipes</h1>
<ul>`;

    rows.forEach(row => {
      const avgRating = row.avgRating !== null ? Number(row.avgRating).toFixed(1) : 'No ratings';
      html += `<li><a href="/recipes/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a> - Rating: ${escapeHtml(String(avgRating))}</li>`;
    });

    html += `</ul>
</body>
</html>`;

    res.status(200).type('text/html').send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
  }

  if (typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'Invalid title' });
  }

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
  }

  for (const ing of ingredients) {
    if (typeof ing !== 'string') {
      return res.status(400).json({ error: 'Each ingredient must be a string' });
    }
  }

  if (typeof instructions !== 'string' || instructions.trim() === '') {
    return res.status(400).json({ error: 'Invalid instructions' });
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title.trim(), ingredientsJson, instructions.trim()],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }

      const recipe = {
        id,
        title: title.trim(),
        ingredients,
        instructions: instructions.trim(),
        comments: [],
        avgRating: null
      };

      res.status(201).json(recipe);
    }
  );
});

// GET /recipes/:recipeId - Get a recipe by ID
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<h1>Server Error</h1>');
    }

    if (!recipe) {
      return res.status(404).send('<h1>Recipe Not Found</h1>');
    }

    db.all('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at ASC', [recipeId], (err, comments) => {
      if (err) {
        console.error(err);
        return res.status(500).send('<h1>Server Error</h1>');
      }

      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingRow) => {
        if (err) {
          console.error(err);
          return res.status(500).send('<h1>Server Error</h1>');
        }

        let ingredients;
        try {
          ingredients = JSON.parse(recipe.ingredients);
        } catch (e) {
          ingredients = [];
        }

        const avgRating = ratingRow && ratingRow.avgRating !== null ? Number(ratingRow.avgRating).toFixed(1) : 'No ratings yet';

        let ingredientsList = ingredients.map(ing => `<li>${escapeHtml(ing)}</li>`).join('');
        let commentsList = comments.length > 0
          ? comments.map(c => `<li>${escapeHtml(c.comment)}</li>`).join('')
          : '<li>No comments yet.</li>';

        const html = `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(recipe.title)}</title></head>
<body>
<h1>${escapeHtml(recipe.title)}</h1>
<h2>Ingredients</h2>
<ul>${ingredientsList}</ul>
<h2>Instructions</h2>
<p>${escapeHtml(recipe.instructions)}</p>
<h2>Average Rating</h2>
<p>${escapeHtml(String(avgRating))}</p>
<h2>Comments</h2>
<ul>${commentsList}</ul>
<p><a href="/recipes">Back to recipes</a></p>
</body>
</html>`;

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
    return res.status(400).json({ error: 'Invalid comment' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    db.run(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [id, recipeId, comment.trim()],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Server error' });
        }
        res.status(201).json({ message: 'Comment added successfully' });
      }
    );
  });
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (rating === undefined || rating === null) {
    return res.status(400).json({ error: 'Rating is required' });
  }

  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    db.run(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [id, recipeId, ratingNum],
      function (err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Server error' });
        }
        res.status(201).json({ message: 'Rating added successfully' });
      }
    );
  });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});