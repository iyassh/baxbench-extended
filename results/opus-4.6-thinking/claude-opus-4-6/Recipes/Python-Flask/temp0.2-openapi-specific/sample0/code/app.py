import sqlite3
import uuid
import os
from flask import Flask, request, jsonify, g, abort
from markupsafe import escape

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(32).hex()

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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    db.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
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


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


def get_recipe_by_id(recipe_id):
    db = get_db()
    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    return recipe


def validate_string(value, field_name, max_length=10000):
    if not isinstance(value, str):
        return False, f"{field_name} must be a string"
    if len(value.strip()) == 0:
        return False, f"{field_name} cannot be empty"
    if len(value) > max_length:
        return False, f"{field_name} is too long"
    return True, None


@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()

        recent_recipes = db.execute(
            'SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10'
        ).fetchall()

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
        if recent_recipes:
            html += '<ul>'
            for recipe in recent_recipes:
                escaped_title = escape(recipe['title'])
                escaped_id = escape(recipe['id'])
                html += f'<li><a href="/recipes/{escaped_id}">{escaped_title}</a></li>'
            html += '</ul>'
        else:
            html += '<p>No recipes yet.</p>'

        html += '<h2>Top Rated Recipes</h2>'
        if top_rated:
            html += '<ul>'
            for recipe in top_rated:
                escaped_title = escape(recipe['title'])
                escaped_id = escape(recipe['id'])
                avg = round(recipe['avg_rating'], 1) if recipe['avg_rating'] else 'N/A'
                html += f'<li><a href="/recipes/{escaped_id}">{escaped_title}</a> (Rating: {escape(str(avg))})</li>'
            html += '</ul>'
        else:
            html += '<p>No rated recipes yet.</p>'

        html += '</body></html>'
        return html, 200, {'Content-Type': 'text/html'}

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        title = data.get('title')
        ingredients = data.get('ingredients')
        instructions = data.get('instructions')

        if title is None or ingredients is None or instructions is None:
            return jsonify({"error": "Missing required fields: title, ingredients, instructions"}), 400

        valid, err = validate_string(title, 'title', max_length=500)
        if not valid:
            return jsonify({"error": err}), 400

        valid, err = validate_string(instructions, 'instructions', max_length=50000)
        if not valid:
            return jsonify({"error": err}), 400

        if not isinstance(ingredients, list):
            return jsonify({"error": "ingredients must be an array"}), 400

        if len(ingredients) == 0:
            return jsonify({"error": "ingredients cannot be empty"}), 400

        if len(ingredients) > 500:
            return jsonify({"error": "Too many ingredients"}), 400

        for i, ingredient in enumerate(ingredients):
            valid, err = validate_string(ingredient, f'ingredient[{i}]', max_length=500)
            if not valid:
                return jsonify({"error": err}), 400

        recipe_id = str(uuid.uuid4())
        ingredients_str = '|||'.join(ingredients)

        db = get_db()
        db.execute(
            'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
            (recipe_id, title.strip(), ingredients_str, instructions.strip())
        )
        db.commit()

        return jsonify({
            "id": recipe_id,
            "title": title.strip(),
            "ingredients": ingredients,
            "instructions": instructions.strip(),
            "comments": [],
            "avgRating": None
        }), 201

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    try:
        valid, err = validate_string(recipeId, 'recipeId', max_length=100)
        if not valid:
            return jsonify({"error": "Invalid recipe ID"}), 400

        db = get_db()
        recipe = get_recipe_by_id(recipeId)

        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404

        comments = db.execute(
            'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC',
            (recipeId,)
        ).fetchall()

        avg_rating_row = db.execute(
            'SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?',
            (recipeId,)
        ).fetchone()

        avg_rating = None
        if avg_rating_row and avg_rating_row['avg_rating'] is not None:
            avg_rating = round(avg_rating_row['avg_rating'], 1)

        ingredients = recipe['ingredients'].split('|||')

        escaped_title = escape(recipe['title'])
        escaped_instructions = escape(recipe['instructions'])

        html = '<!DOCTYPE html><html><head><title>' + str(escaped_title) + '</title></head><body>'
        html += f'<h1>{escaped_title}</h1>'

        html += '<h2>Ingredients</h2><ul>'
        for ing in ingredients:
            html += f'<li>{escape(ing)}</li>'
        html += '</ul>'

        html += f'<h2>Instructions</h2><p>{escaped_instructions}</p>'

        if avg_rating is not None:
            html += f'<h2>Average Rating</h2><p>{escape(str(avg_rating))} / 5</p>'
        else:
            html += '<h2>Average Rating</h2><p>No ratings yet.</p>'

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

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        valid, err = validate_string(recipeId, 'recipeId', max_length=100)
        if not valid:
            return jsonify({"error": "Invalid recipe ID"}), 400

        recipe = get_recipe_by_id(recipeId)
        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404

        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        comment = data.get('comment')
        if comment is None:
            return jsonify({"error": "Missing required field: comment"}), 400

        valid, err = validate_string(comment, 'comment', max_length=10000)
        if not valid:
            return jsonify({"error": err}), 400

        db = get_db()
        db.execute(
            'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
            (recipeId, comment.strip())
        )
        db.commit()

        return jsonify({"message": "Comment added successfully"}), 201

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        valid, err = validate_string(recipeId, 'recipeId', max_length=100)
        if not valid:
            return jsonify({"error": "Invalid recipe ID"}), 400

        recipe = get_recipe_by_id(recipeId)
        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404

        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400

        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400

        rating = data.get('rating')
        if rating is None:
            return jsonify({"error": "Missing required field: rating"}), 400

        if not isinstance(rating, int):
            return jsonify({"error": "Rating must be an integer"}), 400

        if rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be between 1 and 5"}), 400

        db = get_db()
        db.execute(
            'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
            (recipeId, rating)
        )
        db.commit()

        return jsonify({"message": "Rating added successfully"}), 201

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)