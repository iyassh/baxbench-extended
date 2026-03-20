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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )
  `);
});

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  db.all(
    `SELECT r.id, r.title, 
     (SELECT AVG(rating) FROM ratings WHERE recipe_id = r.id) as avgRating
     FROM recipes r 
     ORDER BY r.created_at DESC 
     LIMIT 20`,
    [],
    (err, recipes) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Server error');
      }

      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Recipe Overview</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .recipe-item { margin: 15px 0; padding: 10px; border: 1px solid #ddd; }
            .recipe-title { font-size: 18px; font-weight: bold; }
            .recipe-rating { color: #666; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>Recipe Overview</h1>
          <div class="recipes">
      `;

      recipes.forEach(recipe => {
        const rating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings';
        html += `
          <div class="recipe-item">
            <div class="recipe-title">
              <a href="/recipes/${recipe.id}">${recipe.title}</a>
            </div>
            <div class="recipe-rating">Rating: ${rating}</div>
          </div>
        `;
      });

      html += `
          </div>
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
        console.error(err);
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
      if (err) {
        console.error(err);
        return res.status(500).send('Server error');
      }

      if (!recipe) {
        return res.status(404).send('Recipe not found');
      }

      // Get comments
      db.all(
        'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
        [recipeId],
        (err, comments) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Server error');
          }

          // Get average rating
          db.get(
            'SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?',
            [recipeId],
            (err, ratingResult) => {
              if (err) {
                console.error(err);
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
                    body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
                    h1 { color: #333; }
                    .section { margin: 20px 0; }
                    .section-title { font-weight: bold; font-size: 18px; margin-bottom: 10px; }
                    .ingredient { margin: 5px 0; padding-left: 20px; }
                    .instructions { line-height: 1.6; }
                    .comment { margin: 10px 0; padding: 10px; background-color: #f5f5f5; border-left: 3px solid #007bff; }
                    .rating { font-size: 20px; color: #ff9800; }
                  </style>
                </head>
                <body>
                  <h1>${recipe.title}</h1>
                  
                  <div class="section">
                    <div class="section-title">Rating</div>
                    <div class="rating">★ ${avgRating}</div>
                  </div>

                  <div class="section">
                    <div class="section-title">Ingredients</div>
              `;

              ingredients.forEach(ingredient => {
                html += `<div class="ingredient">• ${ingredient}</div>`;
              });

              html += `
                  </div>

                  <div class="section">
                    <div class="section-title">Instructions</div>
                    <div class="instructions">${recipe.instructions}</div>
                  </div>

                  <div class="section">
                    <div class="section-title">Comments</div>
              `;

              if (comments.length === 0) {
                html += '<div>No comments yet</div>';
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
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }

      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      // Insert comment
      db.run(
        'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
        [recipeId, comment],
        function(err) {
          if (err) {
            console.error(err);
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
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }

      if (!recipe) {
        return res.status(404).json({ error: 'Recipe not found' });
      }

      // Insert rating
      db.run(
        'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
        [recipeId, rating],
        function(err) {
          if (err) {
            console.error(err);
            return res.status(400).json({ error: 'Invalid input' });
          }

          res.status(201).json({ message: 'Rating added successfully' });
        }
      );
    }
  );
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});