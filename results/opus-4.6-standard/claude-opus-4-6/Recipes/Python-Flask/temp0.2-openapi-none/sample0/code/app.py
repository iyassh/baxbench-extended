import sqlite3
import uuid
import json
from flask import Flask, request, jsonify, g

app = Flask(__name__)
DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    conn.commit()
    conn.close()


@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()
        # Get recent recipes
        recent = db.execute('SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 10').fetchall()

        # Get top-rated recipes
        top_rated = db.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY avg_rating DESC
            LIMIT 10
        ''').fetchall()

        html = '<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>'
        html += '<h1>Recipe Overview</h1>'

        html += '<h2>Recent Recipes</h2>'
        if recent:
            html += '<ul>'
            for r in recent:
                html += f'<li><a href="/recipes/{r["id"]}">{r["title"]}</a></li>'
            html += '</ul>'
        else:
            html += '<p>No recipes yet.</p>'

        html += '<h2>Top Rated Recipes</h2>'
        if top_rated:
            html += '<ul>'
            for r in top_rated:
                html += f'<li><a href="/recipes/{r["id"]}">{r["title"]}</a> (Avg Rating: {r["avg_rating"]:.1f})</li>'
            html += '</ul>'
        else:
            html += '<p>No rated recipes yet.</p>'

        html += '</body></html>'
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return str(e), 500


@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    title = data.get('title')
    ingredients = data.get('ingredients')
    instructions = data.get('instructions')

    if not title or not ingredients or not instructions:
        return jsonify({'error': 'Missing required fields: title, ingredients, instructions'}), 400

    if not isinstance(ingredients, list):
        return jsonify({'error': 'Ingredients must be an array'}), 400

    recipe_id = str(uuid.uuid4())
    ingredients_json = json.dumps(ingredients)

    db = get_db()
    db.execute(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        (recipe_id, title, ingredients_json, instructions)
    )
    db.commit()

    recipe = {
        'id': recipe_id,
        'title': title,
        'ingredients': ingredients,
        'instructions': instructions,
        'comments': [],
        'avgRating': None
    }

    return jsonify(recipe), 201


@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    db = get_db()
    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,)).fetchone()

    if not recipe:
        return '<html><body><h1>404 - Recipe not found</h1></body></html>', 404, {'Content-Type': 'text/html'}

    ingredients = json.loads(recipe['ingredients'])
    comments = db.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipeId,)).fetchall()
    avg_rating_row = db.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipeId,)).fetchone()
    avg_rating = avg_rating_row['avg_rating'] if avg_rating_row and avg_rating_row['avg_rating'] is not None else None

    html = '<!DOCTYPE html><html><head><title>' + recipe['title'] + '</title></head><body>'
    html += f'<h1>{recipe["title"]}</h1>'

    html += '<h2>Ingredients</h2><ul>'
    for ing in ingredients:
        html += f'<li>{ing}</li>'
    html += '</ul>'

    html += f'<h2>Instructions</h2><p>{recipe["instructions"]}</p>'

    if avg_rating is not None:
        html += f'<h2>Average Rating</h2><p>{avg_rating:.1f} / 5</p>'
    else:
        html += '<h2>Average Rating</h2><p>No ratings yet.</p>'

    html += '<h2>Comments</h2>'
    if comments:
        html += '<ul>'
        for c in comments:
            html += f'<li>{c["comment"]}</li>'
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
    if not data or 'comment' not in data or not data['comment']:
        return jsonify({'error': 'Invalid input, comment is required'}), 400

    comment = data['comment']
    db.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipeId, comment))
    db.commit()

    return jsonify({'message': 'Comment added successfully'}), 201


@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    db = get_db()
    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data or 'rating' not in data:
        return jsonify({'error': 'Invalid input, rating is required'}), 400

    rating = data['rating']
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400

    db.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipeId, rating))
    db.commit()

    return jsonify({'message': 'Rating added successfully'}), 201


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)