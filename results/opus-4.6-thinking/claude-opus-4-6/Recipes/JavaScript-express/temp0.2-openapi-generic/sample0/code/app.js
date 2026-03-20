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
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);
});

// Helper to escape HTML to prevent XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  const query = `
    SELECT r.id, r.title, r.created_at,
      AVG(rat.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rat ON r.id = rat.recipe_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    // Build top-rated list (sorted by avgRating desc, only those with ratings)
    const topRated = rows
      .filter(r => r.avgRating !== null)
      .sort((a, b) => b.avgRating - a.avgRating)
      .slice(0, 10);

    let html = `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Overview</h1>
<h2>Recent Recipes</h2>
<ul>`;

    rows.forEach(recipe => {
      const rating = recipe.avgRating !== null ? ` (Avg Rating: ${Number(recipe.avgRating).toFixed(1)})` : '';
      html += `<li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>${rating}</li>`;
    });

    html += `</ul>
<h2>Top Rated Recipes</h2>
<ul>`;

    topRated.forEach(recipe => {
      html += `<li><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a> (Avg Rating: ${Number(recipe.avgRating).toFixed(1)})</li>`;
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

  if (typeof title !== 'string' || typeof instructions !== 'string') {
    return res.status(400).json({ error: 'title and instructions must be strings' });
  }

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'ingredients must be a non-empty array of strings' });
  }

  for (const ing of ingredients) {
    if (typeof ing !== 'string') {
      return res.status(400).json({ error: 'Each ingredient must be a string' });
    }
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title, ingredientsJson, instructions],
    function (err) {
      if (err) {
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
});

// GET /recipes/:recipeId - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      return res.status(500).send('Server error');
    }
    if (!recipe) {
      return res.status(404).send('Recipe not found');
    }

    const ingredients = JSON.parse(recipe.ingredients);

    db.all('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('Server error');
      }

      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingRow) => {
        if (err) {
          return res.status(500).send('Server error');
        }

        const avgRating = ratingRow && ratingRow.avgRating !== null ? Number(ratingRow.avgRating).toFixed(1) : 'No ratings yet';

        let html = `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(recipe.title)}</title></head>
<body>
<h1>${escapeHtml(recipe.title)}</h1>
<p><strong>Average Rating:</strong> ${escapeHtml(String(avgRating))}</p>
<h2>Ingredients</h2>
<ul>`;

        ingredients.forEach(ing => {
          html += `<li>${escapeHtml(ing)}</li>`;
        });

        html += `</ul>
<h2>Instructions</h2>
<p>${escapeHtml(recipe.instructions)}</p>
<h2>Comments</h2>
<ul>`;

        if (comments.length === 0) {
          html += '<li>No comments yet.</li>';
        } else {
          comments.forEach(c => {
            html += `<li>${escapeHtml(c.comment)} <em>(${escapeHtml(c.created_at)})</em></li>`;
          });
        }

        html += `</ul>
<p><a href="/recipes">Back to overview</a></p>
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

  if (!comment || typeof comment !== 'string') {
    return res.status(400).json({ error: 'comment is required and must be a string' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      return res.status(500).json({ error: 'Server error' });
    }
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    db.run(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [id, recipeId, comment],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add comment' });
        }
        res.status(201).json({ message: 'Comment added successfully', id });
      }
    );
  });
});

// POST /recipes/:recipeId/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (rating === undefined || rating === null || typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating is required and must be an integer between 1 and 5' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      return res.status(500).json({ error: 'Server error' });
    }
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const id = uuidv4();
    db.run(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [id, recipeId, rating],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add rating' });
        }
        res.status(201).json({ message: 'Rating added successfully', id });
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});