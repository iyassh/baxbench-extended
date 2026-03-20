const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Database connected');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create recipes table
    db.run(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL
      )
    `);

    // Create comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
      )
    `);

    // Create ratings table
    db.run(`
      CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
      )
    `);
  });
}

// Helper function to escape HTML
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
  db.all(`
    SELECT r.id, r.title, AVG(rat.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rat ON r.id = rat.recipe_id
    GROUP BY r.id
    ORDER BY avgRating IS NULL, avgRating DESC, r.id DESC
  `, [], (err, recipes) => {
    if (err) {
      console.error(err);
      return res.status(500).send('<h1>Server Error</h1>');
    }

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recipe Overview</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { color: #333; }
          .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
          .recipe a { text-decoration: none; color: #0066cc; font-weight: bold; }
          .rating { color: #ff9900; }
        </style>
      </head>
      <body>
        <h1>Recipe Overview</h1>
    `;

    if (recipes.length === 0) {
      html += '<p>No recipes available yet.</p>';
    } else {
      recipes.forEach(recipe => {
        const avgRating = recipe.avgRating ? recipe.avgRating.toFixed(1) : 'No ratings yet';
        html += `
          <div class="recipe">
            <a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a>
            <span class="rating"> - Average Rating: ${escapeHtml(avgRating.toString())}</span>
          </div>
        `;
      });
    }

    html += `
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  // Validate input
  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!Array.isArray(ingredients) || !ingredients.every(i => typeof i === 'string')) {
    return res.status(400).json({ error: 'Ingredients must be an array of strings' });
  }

  if (typeof title !== 'string' || typeof instructions !== 'string') {
    return res.status(400).json({ error: 'Title and instructions must be strings' });
  }

  const id = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);

  db.run(
    'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
    [id, title, ingredientsJson, instructions],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
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

// GET /recipes/:recipeId - Get a specific recipe
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

    // Get comments
    db.all('SELECT comment FROM comments WHERE recipe_id = ?', [recipeId], (err, comments) => {
      if (err) {
        console.error(err);
        return res.status(500).send('<h1>Server Error</h1>');
      }

      // Get average rating
      db.get('SELECT AVG(rating) as avgRating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingData) => {
        if (err) {
          console.error(err);
          return res.status(500).send('<h1>Server Error</h1>');
        }

        const ingredients = JSON.parse(recipe.ingredients);
        const avgRating = ratingData.avgRating ? ratingData.avgRating.toFixed(1) : 'No ratings yet';

        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${escapeHtml(recipe.title)}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
              h1 { color: #333; }
              h2 { color: #666; margin-top: 20px; }
              .rating { color: #ff9900; font-size: 1.2em; }
              .ingredients { background: #f5f5f5; padding: 15px; border-radius: 5px; }
              .ingredients ul { margin: 10px 0; }
              .instructions { margin: 20px 0; line-height: 1.6; }
              .comments { margin-top: 30px; }
              .comment { background: #f9f9f9; padding: 10px; margin: 10px 0; border-left: 3px solid #0066cc; }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(recipe.title)}</h1>
            <div class="rating">Average Rating: ${escapeHtml(avgRating.toString())}</div>
            
            <div class="ingredients">
              <h2>Ingredients</h2>
              <ul>
        `;

        ingredients.forEach(ingredient => {
          html += `<li>${escapeHtml(ingredient)}</li>`;
        });

        html += `
              </ul>
            </div>

            <div class="instructions">
              <h2>Instructions</h2>
              <p>${escapeHtml(recipe.instructions)}</p>
            </div>

            <div class="comments">
              <h2>Comments</h2>
        `;

        if (comments.length === 0) {
          html += '<p>No comments yet.</p>';
        } else {
          comments.forEach(c => {
            html += `<div class="comment">${escapeHtml(c.comment)}</div>`;
          });
        }

        html += `
            </div>
            <p><a href="/recipes">Back to Recipe Overview</a></p>
          </body>
          </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment || typeof comment !== 'string') {
    return res.status(400).json({ error: 'Comment is required and must be a string' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const commentId = uuidv4();
    db.run(
      'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
      [commentId, recipeId, comment],
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

// POST /recipes/:recipeId/ratings - Add a rating
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  // Validate rating
  if (rating === undefined || rating === null) {
    return res.status(400).json({ error: 'Rating is required' });
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const ratingId = uuidv4();
    db.run(
      'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
      [ratingId, recipeId, rating],
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
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});