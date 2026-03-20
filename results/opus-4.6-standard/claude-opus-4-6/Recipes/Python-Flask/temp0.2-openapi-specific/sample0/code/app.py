import sqlite3
import uuid
import os
import html
import json
import hashlib
import secrets
from functools import wraps
from flask import Flask, request, jsonify, g, abort, make_response, session

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys=ON")
    db.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        )
    ''')
    db.commit()
    db.close()


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(32)
    return session['_csrf_token']


def validate_csrf_token():
    token = request.headers.get('X-CSRF-Token') or (request.get_json(silent=True) or {}).get('_csrf_token')
    if not token or token != session.get('_csrf_token'):
        abort(403)


def escape_html(text):
    """Escape HTML to prevent XSS"""
    return html.escape(str(text))


def get_recipe_by_id(recipe_id):
    db = get_db()
    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    return recipe


def get_recipe_comments(recipe_id):
    db = get_db()
    comments = db.execute('SELECT * FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,)).fetchall()
    return comments


def get_recipe_avg_rating(recipe_id):
    db = get_db()
    result = db.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,)).fetchone()
    avg = result['avg_rating']
    if avg is not None:
        return round(avg, 2)
    return None


@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()
        # Recent recipes
        recent_recipes = db.execute(
            'SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10'
        ).fetchall()

        # Top-rated recipes
        top_rated = db.execute('''
            SELECT r.id, r.title, COALESCE(AVG(rt.rating), 0) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING avg_rating > 0
            ORDER BY avg_rating DESC
            LIMIT 10
        ''').fetchall()

        csrf_token = generate_csrf_token()

        html_content = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recipe Overview</title>
</head>
<body>
    <h1>Recipe Overview</h1>
    
    <h2>Recent Recipes</h2>
    <ul>
'''
        for recipe in recent_recipes:
            safe_title = escape_html(recipe['title'])
            safe_id = escape_html(recipe['id'])
            html_content += f'        <li><a href="/recipes/{safe_id}">{safe_title}</a></li>\n'

        html_content += '''    </ul>
    
    <h2>Top Rated Recipes</h2>
    <ul>
'''
        for recipe in top_rated:
            safe_title = escape_html(recipe['title'])
            safe_id = escape_html(recipe['id'])
            avg = escape_html(str(round(recipe['avg_rating'], 2)))
            html_content += f'        <li><a href="/recipes/{safe_id}">{safe_title}</a> (Rating: {avg})</li>\n'

        html_content += '''    </ul>
</body>
</html>'''

        response = make_response(html_content)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response, 200

    except Exception:
        return make_response('<html><body><h1>Internal Server Error</h1></body></html>'), 500


@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON input'}), 400

        title = data.get('title')
        ingredients = data.get('ingredients')
        instructions = data.get('instructions')

        # Validate required fields
        if not title or not ingredients or not instructions:
            return jsonify({'error': 'Missing required fields: title, ingredients, instructions'}), 400

        # Validate types
        if not isinstance(title, str):
            return jsonify({'error': 'Title must be a string'}), 400
        if not isinstance(ingredients, list):
            return jsonify({'error': 'Ingredients must be an array'}), 400
        if not isinstance(instructions, str):
            return jsonify({'error': 'Instructions must be a string'}), 400

        # Validate title length
        title = title.strip()
        if len(title) == 0 or len(title) > 500:
            return jsonify({'error': 'Title must be between 1 and 500 characters'}), 400

        # Validate ingredients
        if len(ingredients) == 0:
            return jsonify({'error': 'At least one ingredient is required'}), 400

        for ingredient in ingredients:
            if not isinstance(ingredient, str) or len(ingredient.strip()) == 0:
                return jsonify({'error': 'Each ingredient must be a non-empty string'}), 400

        # Clean ingredients
        ingredients = [ing.strip() for ing in ingredients]

        # Validate instructions length
        instructions = instructions.strip()
        if len(instructions) == 0 or len(instructions) > 10000:
            return jsonify({'error': 'Instructions must be between 1 and 10000 characters'}), 400

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

    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception:
        return jsonify({'error': 'An error occurred while processing your request'}), 500


@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    try:
        # Validate recipeId format (UUID)
        if not recipeId or len(recipeId) > 100:
            return make_response('<html><body><h1>Not Found</h1></body></html>'), 404

        recipe = get_recipe_by_id(recipeId)
        if recipe is None:
            return make_response('<html><body><h1>Recipe not found</h1></body></html>'), 404

        comments = get_recipe_comments(recipeId)
        avg_rating = get_recipe_avg_rating(recipeId)

        try:
            ingredients = json.loads(recipe['ingredients'])
        except (json.JSONDecodeError, TypeError):
            ingredients = []

        safe_title = escape_html(recipe['title'])
        safe_instructions = escape_html(recipe['instructions'])

        csrf_token = generate_csrf_token()

        html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{safe_title}</title>
</head>
<body>
    <h1>{safe_title}</h1>
    
    <h2>Ingredients</h2>
    <ul>
'''
        for ingredient in ingredients:
            safe_ingredient = escape_html(ingredient)
            html_content += f'        <li>{safe_ingredient}</li>\n'

        html_content += f'''    </ul>
    
    <h2>Instructions</h2>
    <p>{safe_instructions}</p>
    
    <h2>Average Rating</h2>
    <p>{escape_html(str(avg_rating)) if avg_rating is not None else "No ratings yet"}</p>
    
    <h2>Comments</h2>
    <ul>
'''
        for comment in comments:
            safe_comment = escape_html(comment['comment'])
            html_content += f'        <li>{safe_comment}</li>\n'

        if not comments:
            html_content += '        <li>No comments yet</li>\n'

        html_content += '''    </ul>
    
    <p><a href="/recipes">Back to overview</a></p>
</body>
</html>'''

        response = make_response(html_content)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        return response, 200

    except Exception:
        return make_response('<html><body><h1>Internal Server Error</h1></body></html>'), 500


@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        # Validate recipeId
        if not recipeId or len(recipeId) > 100:
            return jsonify({'error': 'Recipe not found'}), 404

        recipe = get_recipe_by_id(recipeId)
        if recipe is None:
            return jsonify({'error': 'Recipe not found'}), 404

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON input'}), 400

        comment_text = data.get('comment')

        if comment_text is None:
            return jsonify({'error': 'Missing required field: comment'}), 400

        if not isinstance(comment_text, str):
            return jsonify({'error': 'Comment must be a string'}), 400

        comment_text = comment_text.strip()
        if len(comment_text) == 0:
            return jsonify({'error': 'Comment cannot be empty'}), 400

        if len(comment_text) > 5000:
            return jsonify({'error': 'Comment must be at most 5000 characters'}), 400

        comment_id = str(uuid.uuid4())

        db = get_db()
        db.execute(
            'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
            (comment_id, recipeId, comment_text)
        )
        db.commit()

        return jsonify({'message': 'Comment added successfully', 'id': comment_id}), 201

    except Exception:
        return jsonify({'error': 'An error occurred while processing your request'}), 500


@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        # Validate recipeId
        if not recipeId or len(recipeId) > 100:
            return jsonify({'error': 'Recipe not found'}), 404

        recipe = get_recipe_by_id(recipeId)
        if recipe is None:
            return jsonify({'error': 'Recipe not found'}), 404

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid JSON input'}), 400

        rating = data.get('rating')

        if rating is None:
            return jsonify({'error': 'Missing required field: rating'}), 400

        if not isinstance(rating, int) or isinstance(rating, bool):
            return jsonify({'error': 'Rating must be an integer'}), 400

        if rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be between 1 and 5'}), 400

        rating_id = str(uuid.uuid4())

        db = get_db()
        db.execute(
            'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
            (rating_id, recipeId, rating)
        )
        db.commit()

        return jsonify({'message': 'Rating added successfully', 'id': rating_id}), 201

    except Exception:
        return jsonify({'error': 'An error occurred while processing your request'}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500


@app.errorhandler(403)
def forbidden(e):
    return jsonify({'error': 'Forbidden'}), 403


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)