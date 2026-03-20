const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const db = new sqlite3.Database('./db.sqlite3');

// Middleware
app.use(express.json());

// Initialize database tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    FOREIGN KEY(recipe_id) REFERENCES recipes(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    FOREIGN KEY(recipe_id) REFERENCES recipes(id)
  )`);
});

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  db.all(`
    SELECT r.id, r.title, 
           COALESCE(AVG(rt.rating), NULL) as avgRating,
           COUNT(DISTINCT c.id) as commentCount
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    LEFT JOIN comments c ON r.id = c.recipe_id
    GROUP BY r.id
    ORDER BY r.rowid DESC
  `, (err, recipes) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recipe Overview</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .recipe { margin: 20px 0; padding: 10px; border: 1px solid #ddd; }
          .rating { color: #ff9800; }
        </style>
      </head>
      <body>
        <h1>Recipe Overview</h1>
        <h2>Recent Recipes</h2>
    `;

    if (recipes.length === 0) {
      html += '<p>No recipes available yet.</p>';
    } else {
      recipes.forEach(recipe => {
        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
        html += `
          <div class="recipe">
            <h3><a href="/recipes/${recipe.id}">${recipe.title}</a></h3>
            <p class="rating">Rating: ${rating} ⭐</p>
            <p>Comments: ${recipe.commentCount}</p>
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

// POST /recipes/upload - Upload new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  if (!title || !ingredients || !instructions || !Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title, ingredientsJson, instructions],
    (err) => {
      if (err) {
        return res.status(400).json({ error: 'Invalid input' });
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

// GET /recipes/:recipeId - Get recipe details
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err || !recipe) {
      return res.status(404).send('Recipe not found');
    }

    db.all('SELECT comment FROM comments WHERE recipe_id = ?', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('Server error');
      }

      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingResult) => {
        if (err) {
          return res.status(500).send('Server error');
        }

        const ingredients = JSON.parse(recipe.ingredients);
        const avgRating = ratingResult.avgRating ? ratingResult.avgRating.toFixed(1) : 'No ratings yet';

        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${recipe.title}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              .section { margin: 20px 0; }
              .ingredient { margin: 5px 0; }
              .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
              .rating { color: #ff9800; font-size: 1.2em; }
            </style>
          </head>
          <body>
            <h1>${recipe.title}</h1>
            <p class="rating">Average Rating: ${avgRating} ⭐</p>
            
            <div class="section">
              <h2>Ingredients</h2>
              <ul>
                ${ingredients.map(ing => `<li class="ingredient">${ing}</li>`).join('')}
              </ul>
            </div>
            
            <div class="section">
              <h2>Instructions</h2>
              <p>${recipe.instructions}</p>
            </div>
            
            <div class="section">
              <h2>Comments (${comments.length})</h2>
              ${comments.length === 0 ? '<p>No comments yet.</p>' : ''}
              ${comments.map(c => `<div class="comment">${c.comment}</div>`).join('')}
            </div>
            
            <div class="section">
              <a href="/recipes">Back to overview</a>
            </div>
          </body>
          </html>
        `;

        res.status(200).type('text/html').send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err || !recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    db.run(
      'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
      [recipeId, comment],
      (err) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Comment added successfully' });
      }
    );
  });
});

// POST /recipes/:recipeId/ratings - Add rating
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err || !recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    db.run(
      'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
      [recipeId, rating],
      (err) => {
        if (err) {
          return res.status(400).json({ error: 'Invalid input' });
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