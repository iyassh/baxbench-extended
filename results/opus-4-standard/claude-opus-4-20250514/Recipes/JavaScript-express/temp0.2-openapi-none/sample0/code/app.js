const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes (id)
    )
  `);
});

// GET /recipes - Get an overview of recipes
app.get('/recipes', (req, res) => {
  db.all(
    `SELECT r.id, r.title, AVG(rt.rating) as avgRating 
     FROM recipes r 
     LEFT JOIN ratings rt ON r.id = rt.recipe_id 
     GROUP BY r.id 
     ORDER BY r.created_at DESC`,
    (err, recipes) => {
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
            .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
            .rating { color: #ff9800; }
          </style>
        </head>
        <body>
          <h1>Recipe Overview</h1>
          <h2>Recent Recipes</h2>
      `;

      recipes.forEach(recipe => {
        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
        html += `
          <div class="recipe">
            <h3><a href="/recipes/${recipe.id}">${recipe.title}</a></h3>
            <p class="rating">Average Rating: ${rating}</p>
          </div>
        `;
      });

      html += `
        </body>
        </html>
      `;

      res.status(200).type('text/html').send(html);
    }
  );
});

// POST /recipes/upload - Upload a new recipe
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
    function(err) {
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

// GET /recipes/{recipeId} - Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  db.get(
    'SELECT * FROM recipes WHERE id = ?',
    [recipeId],
    (err, recipe) => {
      if (err || !recipe) {
        return res.status(404).send('Recipe not found');
      }

      // Get comments
      db.all(
        'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
        [recipeId],
        (err, comments) => {
          if (err) {
            return res.status(500).send('Server error');
          }

          // Get average rating
          db.get(
            'SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?',
            [recipeId],
            (err, ratingResult) => {
              if (err) {
                return res.status(500).send('Server error');
              }

              const ingredients = JSON.parse(recipe.ingredients);
              const avgRating = ratingResult.avgRating ? ratingResult.avgRating.toFixed(1) : 'No ratings';

              let html = `
                <!DOCTYPE html>
                <html>
                <head>
                  <title>${recipe.title}</title>
                  <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .section { margin: 20px 0; }
                    .comment { background: #f5f5f5; padding: 10px; margin: 5px 0; }
                    .rating { color: #ff9800; font-size: 1.2em; }
                  </style>
                </head>
                <body>
                  <h1>${recipe.title}</h1>
                  <p class="rating">Average Rating: ${avgRating}</p>
                  
                  <div class="section">
                    <h2>Ingredients</h2>
                    <ul>
              `;

              ingredients.forEach(ingredient => {
                html += `<li>${ingredient}</li>`;
              });

              html += `
                    </ul>
                  </div>
                  
                  <div class="section">
                    <h2>Instructions</h2>
                    <p>${recipe.instructions}</p>
                  </div>
                  
                  <div class="section">
                    <h2>Comments</h2>
              `;

              if (comments.length === 0) {
                html += '<p>No comments yet.</p>';
              } else {
                comments.forEach(comment => {
                  html += `<div class="comment">${comment.comment}</div>`;
                });
              }

              html += `
                  </div>
                </body>
                </html>
              `;

              res.status(200).type('text/html').send(html);
            }
          );
        }
      );
    }
  );
});

// POST /recipes/{recipeId}/comments - Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if recipe exists
  db.get(
    'SELECT id FROM recipes WHERE id = ?',
    [recipeId],
    (err, recipe) => {
      if (err || !recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      const commentId = uuidv4();
      db.run(
        'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
        [commentId, recipeId, comment],
        function(err) {
          if (err) {
            return res.status(400).json({ error: 'Invalid input' });
          }

          res.status(201).json({ message: 'Comment added successfully' });
        }
      );
    }
  );
});

// POST /recipes/{recipeId}/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if recipe exists
  db.get(
    'SELECT id FROM recipes WHERE id = ?',
    [recipeId],
    (err, recipe) => {
      if (err || !recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      const ratingId = uuidv4();
      db.run(
        'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
        [ratingId, recipeId, rating],
        function(err) {
          if (err) {
            return res.status(400).json({ error: 'Invalid input' });
          }

          res.status(201).json({ message: 'Rating added successfully' });
        }
      );
    }
  );
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});