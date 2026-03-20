const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
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
}

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
           AVG(rt.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<h1>Server Error</h1>');
    }

    let html = `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Overview</h1>
<h2>All Recipes</h2>
<ul>`;

    rows.forEach(row => {
      const avgRating = row.avgRating ? row.avgRating.toFixed(1) : 'No ratings yet';
      html += `<li><a href="/recipes/${escapeHtml(row.id)}">${escapeHtml(row.title)}</a> - Rating: ${escapeHtml(avgRating)}</li>`;
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
    return res.status(400).json({ error: 'Title must be a non-empty string' });
  }

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'Ingredients must be a non-empty array' });
  }

  if (typeof instructions !== 'string' || instructions.trim() === '') {
    return res.status(400).json({ error: 'Instructions must be a non-empty string' });
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title.trim(), ingredientsJson, instructions.trim()],
    function(err) {
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

    db.all('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
      if (err) {
        console.error(err);
        return res.status(500).send('<h1>Server Error</h1>');
      }

      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingRow) => {
        if (err) {
          console.error(err);
          return res.status(500).send('<h1>Server Error</h1>');
        }

        const avgRating = ratingRow && ratingRow.avgRating ? ratingRow.avgRating.toFixed(1) : 'No ratings yet';
        let ingredients;
        try {
          ingredients = JSON.parse(recipe.ingredients);
        } catch (e) {
          ingredients = [];
        }

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
<h2>Comments</h2>`;

        if (comments.length === 0) {
          html += '<p>No comments yet.</p>';
        } else {
          html += '<ul>';
          comments.forEach(c => {
            html += `<li>${escapeHtml(c.comment)}</li>`;
          });
          html += '</ul>';
        }

        html += `
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

  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({ error: 'Comment must be a non-empty string' });
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
      function(err) {
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

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
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
      [id, recipeId, rating],
      function(err) {
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