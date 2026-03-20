const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(cookieParser());

// Initialize database
const db = new sqlite3.Database('db.sqlite3');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS csrf_tokens (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Clean up old CSRF tokens periodically
setInterval(() => {
  db.run(`DELETE FROM csrf_tokens WHERE datetime(created_at, '+1 hour') < datetime('now')`);
}, 3600000);

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// HTML escape function
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate CSRF token
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Validate CSRF token
async function validateCsrfToken(token) {
  return new Promise((resolve) => {
    if (!token || typeof token !== 'string' || token.length !== 64) {
      resolve(false);
      return;
    }
    db.get('SELECT token FROM csrf_tokens WHERE token = ?', [token], (err, row) => {
      if (err) {
        console.error('CSRF validation error:', err);
        resolve(false);
      } else {
        resolve(!!row);
      }
    });
  });
}

// Input validation functions
function validateRecipeInput(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0 || data.title.length > 200) return false;
  if (!Array.isArray(data.ingredients) || data.ingredients.length === 0 || data.ingredients.length > 50) return false;
  for (let ingredient of data.ingredients) {
    if (typeof ingredient !== 'string' || ingredient.trim().length === 0 || ingredient.length > 100) return false;
  }
  if (!data.instructions || typeof data.instructions !== 'string' || data.instructions.trim().length === 0 || data.instructions.length > 5000) return false;
  return true;
}

function validateCommentInput(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.comment || typeof data.comment !== 'string' || data.comment.trim().length === 0 || data.comment.length > 1000) return false;
  return true;
}

function validateRatingInput(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) return false;
  return true;
}

function validateRecipeId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// GET /recipes
app.get('/recipes', async (req, res) => {
  try {
    const csrfToken = generateCsrfToken();
    
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO csrf_tokens (token) VALUES (?)', [csrfToken], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.cookie('csrf_token', csrfToken, { 
      httpOnly: true, 
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
    
    db.all(`
      SELECT r.id, r.title, 
             COUNT(DISTINCT rt.id) as rating_count,
             AVG(rt.rating) as avg_rating
      FROM recipes r
      LEFT JOIN ratings rt ON r.id = rt.recipe_id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 20
    `, [], (err, recipes) => {
      if (err) {
        console.error('Database error');
        res.status(500).send('Internal server error');
        return;
      }
      
      let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recipe Sharing App</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; max-width: 1200px; }
    .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
    .recipe a { text-decoration: none; color: #333; }
    .rating { color: #f39c12; }
    form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
    input, textarea { display: block; margin: 10px 0; padding: 5px; width: 100%; max-width: 500px; }
    button { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Recipe Sharing App</h1>
  
  <h2>Upload New Recipe</h2>
  <form id="uploadForm">
    <input type="hidden" id="csrf_token" value="${escapeHtml(csrfToken)}">
    <input type="text" id="title" placeholder="Recipe Title" required maxlength="200">
    <textarea id="ingredients" placeholder="Ingredients (one per line)" required rows="5"></textarea>
    <textarea id="instructions" placeholder="Instructions" required maxlength="5000" rows="5"></textarea>
    <button type="submit">Upload Recipe</button>
  </form>
  
  <h2>Recent Recipes</h2>`;
      
      if (recipes.length === 0) {
        html += '<p>No recipes yet. Be the first to upload one!</p>';
      } else {
        recipes.forEach(recipe => {
          const rating = recipe.avg_rating ? recipe.avg_rating.toFixed(1) : 'No ratings';
          html += `<div class="recipe">
            <h3><a href="/recipes/${escapeHtml(recipe.id)}">${escapeHtml(recipe.title)}</a></h3>
            <span class="rating">Rating: ${escapeHtml(rating)} (${escapeHtml(recipe.rating_count)} ratings)</span>
          </div>`;
        });
      }
      
      html += `
  <script>
    document.getElementById('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ingredients = document.getElementById('ingredients').value.split('\\n').map(i => i.trim()).filter(i => i);
      const data = {
        title: document.getElementById('title').value,
        ingredients: ingredients,
        instructions: document.getElementById('instructions').value
      };
      
      try {
        const response = await fetch('/recipes/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.getElementById('csrf_token').value
          },
          credentials: 'same-origin',
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          const recipe = await response.json();
          alert('Recipe uploaded successfully!');
          window.location.href = '/recipes/' + recipe.id;
        } else {
          alert('Error uploading recipe. Please check your input.');
        }
      } catch (err) {
        alert('Error uploading recipe');
      }
    });
  </script>
</body>
</html>`;
      
      res.set('Content-Type', 'text/html');
      res.send(html);
    });
  } catch (err) {
    console.error('Server error');
    res.status(500).send('Internal server error');
  }
});

// POST /recipes/upload
app.post('/recipes/upload', async (req, res) => {
  try {
    const csrfToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies.csrf_token;
    
    if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
      const isValid = await validateCsrfToken(csrfToken);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
    }
    
    if (!validateRecipeInput(req.body)) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    
    const id = uuidv4();
    const { title, ingredients, instructions } = req.body;
    const ingredientsJson = JSON.stringify(ingredients.map(i => i.trim()));
    
    db.run(
      'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
      [id, title.trim(), ingredientsJson, instructions.trim()],
      function(err) {
        if (err) {
          console.error('Database error');
          res.status(500).json({ error: 'Internal server error' });
          return;
        }
        
        res.status(201).json({
          id,
          title: title.trim(),
          ingredients: ingredients.map(i => i.trim()),
          instructions: instructions.trim(),
          comments: [],
          avgRating: null
        });
      }
    );
  } catch (err) {
    console.error('Server error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /recipes/{recipeId}
app.get('/recipes/:recipeId', async (req, res) => {
  try {
    const csrfToken = generateCsrfToken();
    
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO csrf_tokens (token) VALUES (?)', [csrfToken], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.cookie('csrf_token', csrfToken, { 
      httpOnly: true, 
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
    
    const recipeId = req.params.recipeId;
    
    if (!validateRecipeId(recipeId)) {
      res.status(404).send('Recipe not found');
      return;
    }
    
    db.get('SELECT * FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error');
        res.status(500).send('Internal server error');
        return;
      }
      
      if (!recipe) {
        res.status(404).send('Recipe not found');
        return;
      }
      
      db.all('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC LIMIT 50', [recipeId], (err, comments) => {
        if (err) {
          console.error('Database error');
          res.status(500).send('Internal server error');
          return;
        }
        
        db.get('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM ratings WHERE recipe_id = ?', [recipeId], (err, ratingData) => {
          if (err) {
            console.error('Database error');
            res.status(500).send('Internal server error');
            return;
          }
          
          let ingredients;
          try {
            ingredients = JSON.parse(recipe.ingredients);
          } catch (e) {
            ingredients = [];
          }
          
          const avgRating = ratingData && ratingData.avg_rating ? ratingData.avg_rating.toFixed(1) : 'No ratings yet';
          const ratingCount = ratingData ? ratingData.count : 0;
          
          let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(recipe.title)} - Recipe Sharing App</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; max-width: 1200px; }
    .ingredient { margin: 5px 0; }
    .comment { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
    .rating-form, .comment-form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; }
    input, textarea, select { display: block; margin: 10px 0; padding: 5px; width: 100%; max-width: 500px; }
    button { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
    .back-link { margin: 20px 0; }
  </style>
</head>
<body>
  <div class="back-link"><a href="/recipes">← Back to all recipes</a></div>
  
  <h1>${escapeHtml(recipe.title)}</h1>
  
  <h2>Rating: ${escapeHtml(avgRating)} (${escapeHtml(ratingCount)} ratings)</h2>
  
  <h2>Ingredients:</h2>
  <ul>`;
          
          ingredients.forEach(ingredient => {
            html += `<li class="ingredient">${escapeHtml(ingredient)}</li>`;
          });
          
          html += `</ul>
  
  <h2>Instructions:</h2>
  <p style="white-space: pre-wrap;">${escapeHtml(recipe.instructions)}</p>
  
  <div class="rating-form">
    <h3>Rate this recipe:</h3>
    <form id="ratingForm">
      <input type="hidden" id="csrf_token" value="${escapeHtml(csrfToken)}">
      <select id="rating" required>
        <option value="">Select rating</option>
        <option value="1">1 Star</option>
        <option value="2">2 Stars</option>
        <option value="3">3 Stars</option>
        <option value="4">4 Stars</option>
        <option value="5">5 Stars</option>
      </select>
      <button type="submit">Submit Rating</button>
    </form>
  </div>
  
  <div class="comment-form">
    <h3>Add a comment:</h3>
    <form id="commentForm">
      <textarea id="comment" placeholder="Your comment" required maxlength="1000" rows="3"></textarea>
      <button type="submit">Submit Comment</button>
    </form>
  </div>
  
  <h2>Comments:</h2>`;
          
          if (comments.length === 0) {
            html += '<p>No comments yet. Be the first to comment!</p>';
          } else {
            comments.forEach(comment => {
              const date = new Date(comment.created_at).toLocaleString();
              html += `<div class="comment">
                <p>${escapeHtml(comment.comment)}</p>
                <small>Posted on ${escapeHtml(date)}</small>
              </div>`;
            });
          }
          
          html += `
  <script>
    document.getElementById('ratingForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        rating: parseInt(document.getElementById('rating').value)
      };
      
      try {
        const response = await fetch('/recipes/${escapeHtml(recipeId)}/ratings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.getElementById('csrf_token').value
          },
          credentials: 'same-origin',
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          alert('Rating submitted successfully!');
          location.reload();
        } else {
          alert('Error submitting rating');
        }
      } catch (err) {
        alert('Error submitting rating');
      }
    });
    
    document.getElementById('commentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        comment: document.getElementById('comment').value
      };
      
      try {
        const response = await fetch('/recipes/${escapeHtml(recipeId)}/comments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': document.getElementById('csrf_token').value
          },
          credentials: 'same-origin',
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          alert('Comment added successfully!');
          location.reload();
        } else {
          alert('Error adding comment');
        }
      } catch (err) {
        alert('Error adding comment');
      }
    });
  </script>
</body>
</html>`;
          
          res.set('Content-Type', 'text/html');
          res.send(html);
        });
      });
    });
  } catch (err) {
    console.error('Server error');
    res.status(500).send('Internal server error');
  }
});

// POST /recipes/{recipeId}/comments
app.post('/recipes/:recipeId/comments', async (req, res) => {
  try {
    const csrfToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies.csrf_token;
    
    if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
      const isValid = await validateCsrfToken(csrfToken);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
    }
    
    if (!validateCommentInput(req.body)) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    
    const recipeId = req.params.recipeId;
    
    if (!validateRecipeId(recipeId)) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }
    
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error');
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      
      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' });
        return;
      }
      
      const { comment } = req.body;
      
      db.run(
        'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
        [recipeId, comment.trim()],
        function(err) {
          if (err) {
            console.error('Database error');
            res.status(500).json({ error: 'Internal server error' });
            return;
          }
          
          res.status(201).json({ message: 'Comment added successfully' });
        }
      );
    });
  } catch (err) {
    console.error('Server error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /recipes/{recipeId}/ratings
app.post('/recipes/:recipeId/ratings', async (req, res) => {
  try {
    const csrfToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies.csrf_token;
    
    if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
      const isValid = await validateCsrfToken(csrfToken);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
    }
    
    if (!validateRatingInput(req.body)) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    
    const recipeId = req.params.recipeId;
    
    if (!validateRecipeId(recipeId)) {
      res.status(404).json({ error: 'Recipe not found' });
      return;
    }
    
    db.get('SELECT id FROM recipes WHERE id = ?', [recipeId], (err, recipe) => {
      if (err) {
        console.error('Database error');
        res.status(500).json({ error: 'Internal server error' });
        return;
      }
      
      if (!recipe) {
        res.status(404).json({ error: 'Recipe not found' });
        return;
      }
      
      const { rating } = req.body;
      
      db.run(
        'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
        [recipeId, rating],
        function(err) {
          if (err) {
            console.error('Database error');
            res.status(500).json({ error: 'Internal server error' });
            return;
          }
          
          res.status(201).json({ message: 'Rating added successfully' });
        }
      );
    });
  } catch (err) {
    console.error('Server error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});