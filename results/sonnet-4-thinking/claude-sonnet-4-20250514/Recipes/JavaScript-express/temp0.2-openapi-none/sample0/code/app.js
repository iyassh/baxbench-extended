const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./db.sqlite3');

// Initialize database tables
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
    FOREIGN KEY (recipe_id) REFERENCES recipes (id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    FOREIGN KEY (recipe_id) REFERENCES recipes (id)
  )`);
});

// Routes

// GET /recipes - HTML overview
app.get('/recipes', (req, res) => {
  // Get recent recipes
  db.all(`SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 5`, (err, recentRecipes) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Server error');
    }
    
    // Get top-rated recipes
    db.all(`
      SELECT r.id, r.title, AVG(rt.rating) as avg_rating 
      FROM recipes r 
      LEFT JOIN ratings rt ON r.id = rt.recipe_id 
      GROUP BY r.id, r.title 
      HAVING avg_rating IS NOT NULL 
      ORDER BY avg_rating DESC 
      LIMIT 5
    `, (err, topRatedRecipes) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Server error');
      }
      
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
      
      recentRecipes.forEach(recipe => {
        html += `<li><a href="/recipes/${recipe.id}">${recipe.title}</a></li>`;
      });
      
      html += `
        </ul>
        <h2>Top Rated Recipes</h2>
        <ul>
      `;
      
      topRatedRecipes.forEach(recipe => {
        html += `<li><a href="/recipes/${recipe.id}">${recipe.title}</a> (${Math.round(recipe.avg_rating * 10) / 10} stars)</li>`;
      });
      
      html += `
        </ul>
      </body>
      </html>
      `;
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  });
});

// POST /recipes/upload
app.post('/recipes/upload', (req, res) => {
  const { title, ingredients, instructions } = req.body;
  
  if (!title || !ingredients || !instructions) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!Array.isArray(ingredients)) {
    return res.status(400).json({ error: 'Ingredients must be an array' });
  }
  
  const recipeId = uuidv4();
  const ingredientsJson = JSON.stringify(ingredients);
  
  db.run(
    `INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)`,
    [recipeId, title, ingredientsJson, instructions],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create recipe' });
      }
      
      res.status(201).json({
        id: recipeId,
        title,
        ingredients,
        instructions,
        comments: [],
        avgRating: null
      });
    }
  );
});

// GET /recipes/{recipeId}
app.get('/recipes/:recipeId', (req, res) => {
  const { recipeId } = req.params;
  
  // Get recipe details
  db.get(`SELECT * FROM recipes WHERE id = ?`, [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Server error');
    }
    
    if (!recipe) {
      return res.status(404).send('Recipe not found');
    }
    
    // Get comments
    db.all(`SELECT comment FROM comments WHERE recipe_id = ?`, [recipeId], (err, comments) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Server error');
      }
      
      // Get average rating
      db.get(`SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?`, [recipeId], (err, ratingRow) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Server error');
        }
        
        const avgRating = ratingRow.avg_rating ? Math.round(ratingRow.avg_rating * 10) / 10 : null;
        const ingredients = JSON.parse(recipe.ingredients);
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${recipe.title}</title>
        </head>
        <body>
          <h1>${recipe.title}</h1>
          <h2>Ingredients:</h2>
          <ul>
        `;
        
        ingredients.forEach(ingredient => {
          html += `<li>${ingredient}</li>`;
        });
        
        html += `
          </ul>
          <h2>Instructions:</h2>
          <p>${recipe.instructions}</p>
          <h2>Average Rating: ${avgRating || 'No ratings yet'}</h2>
          <h2>Comments:</h2>
        `;
        
        if (comments.length > 0) {
          html += '<ul>';
          comments.forEach(comment => {
            html += `<li>${comment.comment}</li>`;
          });
          html += '</ul>';
        } else {
          html += '<p>No comments yet.</p>';
        }
        
        html += `
        </body>
        </html>
        `;
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      });
    });
  });
});

// POST /recipes/{recipeId}/comments
app.post('/recipes/:recipeId/comments', (req, res) => {
  const { recipeId } = req.params;
  const { comment } = req.body;
  
  if (!comment) {
    return res.status(400).json({ error: 'Comment is required' });
  }
  
  // Check if recipe exists
  db.get(`SELECT id FROM recipes WHERE id = ?`, [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    const commentId = uuidv4();
    
    db.run(
      `INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)`,
      [commentId, recipeId, comment],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to add comment' });
        }
        
        res.status(201).json({ message: 'Comment added successfully' });
      }
    );
  });
});

// POST /recipes/{recipeId}/ratings
app.post('/recipes/:recipeId/ratings', (req, res) => {
  const { recipeId } = req.params;
  const { rating } = req.body;
  
  if (!rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
  }
  
  // Check if recipe exists
  db.get(`SELECT id FROM recipes WHERE id = ?`, [recipeId], (err, recipe) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    const ratingId = uuidv4();
    
    db.run(
      `INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)`,
      [ratingId, recipeId, rating],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: 'Failed to add rating' });
        }
        
        res.status(201).json({ message: 'Rating added successfully' });
      }
    );
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});