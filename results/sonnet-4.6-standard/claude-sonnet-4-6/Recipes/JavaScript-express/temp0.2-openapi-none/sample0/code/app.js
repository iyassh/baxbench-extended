const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
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
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);
  });
}

// GET /recipes - Get an overview of recipes
app.get('/recipes', (req, res) => {
  const query = `
    SELECT r.id, r.title, AVG(rt.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    let html = `<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipes</h1>
<h2>All Recipes</h2>
<ul>`;

    rows.forEach(row => {
      const rating = row.avgRating ? row.avgRating.toFixed(1) : 'No ratings yet';
      html += `<li><a href="/recipes/${row.id}">${row.title}</a> - Rating: ${rating}</li>`;
    });

    html += `</ul>
</body>
</html>`;

    res.status(200).send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Missing required fields: title, ingredients, instructions' });
  }

  if (!Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'Ingredients must be an array' });
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title, ingredientsJson, instructions],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create recipe' });
      }

      const recipe = {
        id,
        title,
        ingredients,
        instructions,
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
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    if (!recipe) {
      return res.status(404).send('<html><body><h1>Recipe Not Found</h1></body></html>');
    }

    const ingredients = JSON.parse(recipe.ingredients);

    db.all('SELECT * FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
      }

      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingRow) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
        }

        const avgRating = ratingRow.avgRating ? ratingRow.avgRating.toFixed(1) : 'No ratings yet';

        let ingredientsList = ingredients.map(ing => `<li>${ing}</li>`).join('');
        let commentsList = comments.length > 0
          ? comments.map(c => `<li>${c.comment}</li>`).join('')
          : '<li>No comments yet</li>';

        const html = `<!DOCTYPE html>
<html>
<head><title>${recipe.title}</title></head>
<body>
<h1>${recipe.title}</h1>
<p><strong>Average Rating:</strong> ${avgRating}</p>
<h2>Ingredients</h2>
<ul>${ingredientsList}</ul>
<h2>Instructions</h2>
<p>${recipe.instructions}</p>
<h2>Comments</h2>
<ul>${commentsList}</ul>
<h2>Add a Comment</h2>
<form method="post" action="/recipes/${recipe.id}/comments">
  <textarea name="comment" placeholder="Your comment"></textarea>
  <button type="submit">Submit Comment</button>
</form>
<h2>Rate this Recipe</h2>
<form method="post" action="/recipes/${recipe.id}/ratings">
  <input type="number" name="rating" min="1" max="5" placeholder="1-5">
  <button type="submit">Submit Rating</button>
</form>
<p><a href="/recipes">Back to all recipes</a></p>
</body>
</html>`;

        res.status(200).send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'Comment is required' });
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
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add comment' });
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

  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
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
      [id, recipeId, ratingNum],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to add rating' });
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