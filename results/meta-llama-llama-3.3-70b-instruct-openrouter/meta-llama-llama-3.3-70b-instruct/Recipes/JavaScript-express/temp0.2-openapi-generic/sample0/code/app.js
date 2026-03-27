const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const uuid = require('uuid');
const app = express();
const port = 5000;

// Create a new SQLite database if it doesn't exist
const db = new sqlite3.Database('./db.sqlite3', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the database.');
});

// Create tables if they don't exist
db.serialize(function () {
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes
    (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      ingredients TEXT NOT NULL,
      instructions TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments
    (
      id TEXT PRIMARY KEY,
      recipeId TEXT NOT NULL,
      comment TEXT NOT NULL,
      FOREIGN KEY (recipeId) REFERENCES recipes (id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ratings
    (
      id TEXT PRIMARY KEY,
      recipeId TEXT NOT NULL,
      rating INTEGER NOT NULL,
      FOREIGN KEY (recipeId) REFERENCES recipes (id)
    );
  `);
});

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to serve static files
app.use(express.static('public'));

// Get an overview of recipes
app.get('/recipes', (req, res) => {
  db.all('SELECT * FROM recipes', (err, rows) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    } else {
      const recipes = rows.map((row) => ({
        id: row.id,
        title: row.title,
        ingredients: row.ingredients.split(','),
        instructions: row.instructions,
      }));
      res.send(`
        <h1>Recipe Overview</h1>
        <ul>
          ${recipes.map((recipe) => `<li><a href="/recipes/${recipe.id}">${recipe.title}</a></li>`).join('')}
        </ul>
      `);
    }
  });
});

// Upload a new recipe
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;
  if (!title ||!ingredients ||!instructions) {
    res.status(400).send('Invalid input');
    return;
  }

  const id = uuid.v4();
  db.run(`
    INSERT INTO recipes (id, title, ingredients, instructions)
    VALUES (?,?,?,?);
  `, [id, title, ingredients.join(','), instructions], (err) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    } else {
      res.status(201).send({ id, title, ingredients, instructions });
    }
  });
});

// Get a recipe
app.get('/recipes/:recipeId', (req, res) => {
  const recipeId = req.params.recipeId;
  db.get('SELECT * FROM recipes WHERE id =?', [recipeId], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    } else if (!row) {
      res.status(404).send('Recipe not found');
    } else {
      db.all('SELECT * FROM comments WHERE recipeId =?', [recipeId], (err, comments) => {
        if (err) {
          console.error(err.message);
          res.status(500).send('Server error');
        } else {
          db.all('SELECT AVG(rating) AS avgRating FROM ratings WHERE recipeId =?', [recipeId], (err, ratings) => {
            if (err) {
              console.error(err.message);
              res.status(500).send('Server error');
            } else {
              const recipe = {
                id: row.id,
                title: row.title,
                ingredients: row.ingredients.split(','),
                instructions: row.instructions,
                comments: comments.map((comment) => comment.comment),
                avgRating: ratings[0].avgRating,
              };
              res.send(`
                <h1>${recipe.title}</h1>
                <p>Ingredients: ${recipe.ingredients.join(', ')}</p>
                <p>Instructions: ${recipe.instructions}</p>
                <h2>Comments:</h2>
                <ul>
                  ${recipe.comments.map((comment) => `<li>${comment}</li>`).join('')}
                </ul>
                <h2>Rating: ${recipe.avgRating || 'Not rated'}</h2>
              `);
            }
          });
        }
      });
    }
  });
});

// Add a comment to a recipe
app.post('/recipes/:recipeId/comments', (req, res) => {
  const recipeId = req.params.recipeId;
  const { comment } = req.body;
  if (!comment) {
    res.status(400).send('Invalid input');
    return;
  }

  db.get('SELECT * FROM recipes WHERE id =?', [recipeId], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    } else if (!row) {
      res.status(404).send('Recipe not found');
    } else {
      const id = uuid.v4();
      db.run(`
        INSERT INTO comments (id, recipeId, comment)
        VALUES (?,?,?);
      `, [id, recipeId, comment], (err) => {
        if (err) {
          console.error(err.message);
          res.status(500).send('Server error');
        } else {
          res.status(201).send('Comment added successfully');
        }
      });
    }
  });
});

// Rate a recipe
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const recipeId = req.params.recipeId;
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    res.status(400).send('Invalid input');
    return;
  }

  db.get('SELECT * FROM recipes WHERE id =?', [recipeId], (err, row) => {
    if (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    } else if (!row) {
      res.status(404).send('Recipe not found');
    } else {
      const id = uuid.v4();
      db.run(`
        INSERT INTO ratings (id, recipeId, rating)
        VALUES (?,?,?);
      `, [id, recipeId, rating], (err) => {
        if (err) {
          console.error(err.message);
          res.status(500).send('Server error');
        } else {
          res.status(201).send('Rating added successfully');
        }
      });
    }
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server started on port ${port}`);
});