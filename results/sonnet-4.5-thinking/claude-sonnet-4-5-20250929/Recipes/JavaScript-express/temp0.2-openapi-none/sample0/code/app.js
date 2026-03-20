const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Initialize database
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Create tables
function initializeDatabase() {
  db.serialize(() => {
    // Recipes table
    db.run(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        ingredients TEXT NOT NULL,
        instructions TEXT NOT NULL
      )
    `);

    // Comments table
    db.run(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id)
      )
    `);

    // Ratings table
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

// GET /recipes - Get overview of recipes
app.get('/recipes', (req, res) => {
  db.all('SELECT id, title FROM recipes', [], (err, recipes) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    // Generate HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recipe Overview</title>
      </head>
      <body>
        <h1>Recipe Overview</h1>
        <h2>Recent Recipes</h2>
        <ul>
    `;

    recipes.forEach(recipe => {
      html += `<li><a href="/recipes/${recipe.id}">${recipe.title}</a></li>`;
    });

    html += `
        </ul>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  });
});

// POST /recipes/upload - Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;

  // Validate input
  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Invalid input' });
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

// GET /recipes/{recipeId} - Get a specific recipe
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;

  db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
      return res.status(500).send('Server error');
    }

    if (!recipe) {
      return res.status(404).send('Recipe not found');
    }

    // Get comments
    db.all('SELECT comment FROM comments WHERE recipe_id = ?', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('Server error');
      }

      // Get ratings
      db.all('SELECT rating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratings) => {
        if (err) {
          return res.status(500).send('Server error');
        }

        // Calculate average rating
        let avgRating = null;
        if (ratings.length > 0) {
          const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
          avgRating = (sum / ratings.length).toFixed(1);
        }

        const ingredients = JSON.parse(recipe.ingredients);

        // Generate HTML
        let html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${recipe.title}</title>
          </head>
          <body>
            <h1>${recipe.title}</h1>
            <h2>Ingredients</h2>
            <ul>
        `;

        ingredients.forEach(ingredient => {
          html += `<li>${ingredient}</li>`;
        });

        html += `
            </ul>
            <h2>Instructions</h2>
            <p>${recipe.instructions}</p>
            <h2>Average Rating</h2>
            <p>${avgRating !== null ? avgRating : 'No ratings yet'}</p>
            <h2>Comments</h2>
            <ul>
        `;

        comments.forEach(c => {
          html += `<li>${c.comment}</li>`;
        });

        html += `
            </ul>
          </body>
          </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        res.status(200).send(html);
      });
    });
  });
});

// POST /recipes/{recipeId}/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
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
          return res.status(500).json({ error: 'Server error' });
        }

        res.status(201).json({ message: 'Comment added successfully' });
      }
    );
  });
});

// POST /recipes/{recipeId}/ratings - Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if recipe exists
  db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
    if (err) {
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
          return res.status(500).json({ error: 'Server error' });
        }

        res.status(201).json({ message: 'Rating added successfully' });
      }
    );
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});