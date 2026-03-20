import sqlite3
import uuid
from flask import Flask, request, jsonify, g

app = Flask(__name__)

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        );
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        );
    ''')
    conn.commit()
    conn.close()


import json
from markupsafe import escape


@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()
        # Get recent recipes
        recent = db.execute(
            'SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating '
            'FROM recipes r LEFT JOIN ratings rt ON r.id = rt.recipe_id '
            'GROUP BY r.id ORDER BY r.created_at DESC LIMIT 10'
        ).fetchall()

        # Get top-rated recipes
        top_rated = db.execute(
            'SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating '
            'FROM recipes r LEFT JOIN ratings rt ON r.id = rt.recipe_id '
            'GROUP BY r.id HAVING COUNT(rt.rating) > 0 ORDER BY avg_rating DESC LIMIT 10'
        ).fetchall()

        html = '<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>'
        html += '<h1>Recipe Overview</h1>'

        html += '<h2>Recent Recipes</h2>'
        if recent:
            html += '<ul>'
            for r in recent:
                title = escape(r['title'])
                avg = round(r['avg_rating'], 1) if r['avg_rating'] else 'No ratings'
                html += f'<li><a href="/recipes/{escape(r["id"])}">{title}</a> (Avg Rating: {avg})</li>'
            html += '</ul>'
        else:
            html += '<p>No recipes yet.</p>'

        html += '<h2>Top Rated Recipes</h2>'
        if top_rated:
            html += '<ul>'
            for r in top_rated:
                title = escape(r['title'])
                avg = round(r['avg_rating'], 1)
                html += f'<li><a href="/recipes/{escape(r["id"])}">{title}</a> (Avg Rating: {avg})</li>'
            html += '</ul>'
        else:
            html += '<p>No rated recipes yet.</p>'

        html += '</body></html>'
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return f'<html><body><h1>Server Error</h1><p>{escape(str(e))}</p></body></html>', 500


@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input: JSON body required'}), 400

    title = data.get('title')
    ingredients = data.get('ingredients')
    instructions = data.get('instructions')

    if not title or not isinstance(title, str) or not title.strip():
        return jsonify({'error': 'Invalid input: title is required and must be a non-empty string'}), 400
    if not ingredients or not isinstance(ingredients, list) or len(ingredients) == 0:
        return jsonify({'error': 'Invalid input: ingredients is required and must be a non-empty array'}), 400
    for ing in ingredients:
        if not isinstance(ing, str):
            return jsonify({'error': 'Invalid input: each ingredient must be a string'}), 400
    if not instructions or not isinstance(instructions, str) or not instructions.strip():
        return jsonify({'error': 'Invalid input: instructions is required and must be a non-empty string'}), 400

    recipe_id = str(uuid.uuid4())
    ingredients_json = json.dumps(ingredients)

    db = get_db()
    db.execute(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        (recipe_id, title.strip(), ingredients_json, instructions.strip())
    )
    db.commit()

    recipe = {
        'id': recipe_id,
        'title': title.strip(),
        'ingredients': ingredients,
        'instructions': instructions.strip(),
        'comments': [],
        'avgRating': None
    }
    return jsonify(recipe), 201


@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    db = get_db()
    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if not recipe:
        return '<html><body><h1>404 Not Found</h1><p>Recipe not found.</p></body></html>', 404

    comments = db.execute(
        'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at ASC', (recipeId,)
    ).fetchall()

    avg_rating_row = db.execute(
        'SELECT AVG(rating) as avg_rating, COUNT(rating) as cnt FROM ratings WHERE recipe_id = ?', (recipeId,)
    ).fetchone()

    avg_rating = None
    if avg_rating_row and avg_rating_row['cnt'] > 0:
        avg_rating = round(avg_rating_row['avg_rating'], 1)

    ingredients = json.loads(recipe['ingredients'])

    title = escape(recipe['title'])
    instructions = escape(recipe['instructions'])

    html = '<!DOCTYPE html><html><head><title>' + str(title) + '</title></head><body>'
    html += f'<h1>{title}</h1>'

    html += '<h2>Ingredients</h2><ul>'
    for ing in ingredients:
        html += f'<li>{escape(ing)}</li>'
    html += '</ul>'

    html += f'<h2>Instructions</h2><p>{instructions}</p>'

    html += '<h2>Average Rating</h2>'
    if avg_rating is not None:
        html += f'<p>{avg_rating} / 5</p>'
    else:
        html += '<p>No ratings yet.</p>'

    html += '<h2>Comments</h2>'
    if comments:
        html += '<ul>'
        for c in comments:
            html += f'<li>{escape(c["comment"])}</li>'
        html += '</ul>'
    else:
        html += '<p>No comments yet.</p>'

    html += '</body></html>'
    return html, 200, {'Content-Type': 'text/html'}


@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    db = get_db()
    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input: JSON body required'}), 400

    comment = data.get('comment')
    if not comment or not isinstance(comment, str) or not comment.strip():
        return jsonify({'error': 'Invalid input: comment is required and must be a non-empty string'}), 400

    db.execute(
        'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
        (recipeId, comment.strip())
    )
    db.commit()

    return jsonify({'message': 'Comment added successfully'}), 201


@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    db = get_db()
    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input: JSON body required'}), 400

    rating = data.get('rating')
    if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Invalid input: rating must be an integer between 1 and 5'}), 400

    db.execute(
        'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
        (recipeId, rating)
    )
    db.commit()

    return jsonify({'message': 'Rating added successfully'}), 201


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)