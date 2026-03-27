const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

let db = new sqlite3.Database('./db.sqlite3');

app.get('/recipes', (req, res) => {
    db.all('SELECT * FROM recipes ORDER BY created_at DESC, avg_rating DESC', [], (err, rows) => {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.send(rows);
    });
});

app.post('/recipes/upload', (req, res) => {
    const { title, ingredients, instructions } = req.body;
    if (!title || !ingredients || !instructions) {
        res.status(400).send('Missing required fields');
        return;
    }
    db.run('INSERT INTO recipes (title, ingredients, instructions) VALUES (?, ?, ?)', [title, JSON.stringify(ingredients), instructions], function(err) {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.status(201).json({ id: this.lastID });
    });
});

app.get('/recipes/:recipeId', (req, res) => {
    db.get(`SELECT * FROM recipes WHERE id = ?`, [req.params.recipeId], (err, row) => {
        if (err) {
            res.status(500).send(err);
            return;
        }
        if (!row) {
            res.status(404).send('Recipe not found');
            return;
        }
        res.send(row);
    });
});

app.post('/recipes/:recipeId/comments', (req, res) => {
    const { comment } = req.body;
    if (!comment) {
        res.status(400).send('Missing required fields');
        return;
    }
    db.run('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', [req.params.recipeId, comment], function(err) {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.status(201).send('Comment added successfully');
    });
});

app.post('/recipes/:recipeId/ratings', (req, res) => {
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
        res.status(400).send('Invalid rating');
        return;
    }
    db.run(`UPDATE recipes SET ratings_count = ratings_count + 1, avg_rating = ((avg_rating * ratings_count) + ?) / (ratings_count + 1) WHERE id = ?`, [rating, req.params.recipeId], function(err) {
        if (err) {
            res.status(500).send(err);
            return;
        }
        res.status(201).send('Rating added successfully');
    });
});

app.listen(5000, '0.0.0.0', () => console.log('Listening on port 5000'));