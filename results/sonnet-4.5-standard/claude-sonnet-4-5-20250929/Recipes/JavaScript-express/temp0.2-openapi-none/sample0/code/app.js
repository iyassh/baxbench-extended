<CODE>
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
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
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      comment TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);
  });
}

// GET /recipes - Overview of recipes
app.get('/recipes', (req, res) => {
  db.all(`
    SELECT r.id, r.title, AVG(rt.rating) as avgRating
    FROM recipes r
    LEFT JOIN ratings rt ON r.id = rt.recipe_id
    GROUP BY r.id
    ORDER BY avgRating DESC, r.id DESC
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }

    let html = '<html><body><h1>Recipe Overview</h1><ul>';
    rows.forEach(row => {
      const avgRating = row.avgRating ? row.avgRating.toFixed(1) : 'No ratings';
      html += `<li><a href="/recipes/${row.id}">${row.title}</a> - Rating: ${avgRating}</li>`;
    });
    html += '</ul></body></html>';
    
    res.status(200).type('text/html').send(html);
  });
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
      return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
    }
    if (!recipe) {
      return res.status(404).send('<html><body><h1>Recipe not found</h1></body></html>');
    }

    db.all('SELECT comment FROM comments WHERE recipe_id = ?', [recipeId], (err, comments) => {
      if (err) {
        return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
      }

      db.all('SELECT rating FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratings) => {
        if (err) {
          return res.status(500).send('<html><body><h1>Server Error</h1></body></html>');
        }

        const avgRating = ratings.length > 0
          ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
          : 'No ratings';

        const ingredients = JSON.parse(recipe.ingredients);
        
        let html = `<html><body>
          <h1>${recipe.title}</h1>
          <h2>Ingredients:</h2>
          <ul>`;
        ingredients.forEach(ing => {
          html += `<li>${ing}</li>`;
        });
        html += `</ul>
          <h2>Instructions:</h2>
          <p>${recipe.instructions}</p>
          <h2>Average Rating: ${avgRating}</h2>
          <h2>Comments:</h2>
          <ul>`;
        comments.forEach(c => {
          html += `<li>${c.comment}</li>`;
        });
        html += `</ul></body></html>`;

        res.status(200).type('text/html').send(html);
      });
    });
  });
});

// POST /recipes/:recipeId/comments - Add a comment
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ error: 'Invalid input' });
  }

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
          return res.status(400).json({ error: 'Invalid input' });
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

  if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

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
          return res.status(400).json({ error: 'Invalid input' });
        }
        res.status(201).json({ message: 'Rating added successfully' });
      }
    );
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});
</CODE>