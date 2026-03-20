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


def escape_html(text):
    """Escape HTML special characters to prevent XSS."""
    if text is None:
        return ''
    text = str(text)
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    text = text.replace('"', '&quot;')
    text = text.replace("'", '&#x27;')
    return text


@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()

        # Recent recipes
        recent = db.execute(
            'SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10'
        ).fetchall()

        # Top-rated recipes
        top_rated = db.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING avg_rating IS NOT NULL
            ORDER BY avg_rating DESC
            LIMIT 10
        ''').fetchall()

        html = '''<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Overview</h1>
<h2>Recent Recipes</h2>
<ul>'''
        for recipe in recent:
            html += f'<li><a href="/recipes/{escape_html(recipe["id"])}">{escape_html(recipe["title"])}</a></li>'

        html += '''</ul>
<h2>Top Rated Recipes</h2>
<ul>'''
        for recipe in top_rated:
            avg = round(recipe["avg_rating"], 1) if recipe["avg_rating"] else 'N/A'
            html += f'<li><a href="/recipes/{escape_html(recipe["id"])}">{escape_html(recipe["title"])}</a> (Rating: {escape_html(str(avg))})</li>'

        html += '''</ul>
</body>
</html>'''

        return html, 200, {'Content-Type': 'text/html'}
    except Exception:
        return 'Server error', 500


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

    if not isinstance(title, str) or not title.strip():
        return jsonify({'error': 'Title must be a non-empty string'}), 400

    if not isinstance(ingredients, list) or len(ingredients) == 0:
        return jsonify({'error': 'Ingredients must be a non-empty array'}), 400

    for ing in ingredients:
        if not isinstance(ing, str):
            return jsonify({'error': 'Each ingredient must be a string'}), 400

    if not isinstance(instructions, str) or not instructions.strip():
        return jsonify({'error': 'Instructions must be a non-empty string'}), 400

    recipe_id = str(uuid.uuid4())
    ingredients_str = '|||'.join(ingredients)

    db = get_db()
    db.execute(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        (recipe_id, title.strip(), ingredients_str, instructions.strip())
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
        return 'Recipe not found', 404

    comments = db.execute(
        'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at ASC', (recipeId,)
    ).fetchall()

    avg_rating_row = db.execute(
        'SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipeId,)
    ).fetchone()

    avg_rating = round(avg_rating_row['avg_rating'], 1) if avg_rating_row and avg_rating_row['avg_rating'] else None

    ingredients = recipe['ingredients'].split('|||')

    html = f'''<!DOCTYPE html>
<html>
<head><title>{escape_html(recipe["title"])}</title></head>
<body>
<h1>{escape_html(recipe["title"])}</h1>
<h2>Ingredients</h2>
<ul>'''
    for ing in ingredients:
        html += f'<li>{escape_html(ing)}</li>'

    html += f'''</ul>
<h2>Instructions</h2>
<p>{escape_html(recipe["instructions"])}</p>
<h2>Average Rating</h2>
<p>{escape_html(str(avg_rating)) if avg_rating is not None else "No ratings yet"}</p>
<h2>Comments</h2>
<ul>'''
    for c in comments:
        html += f'<li>{escape_html(c["comment"])}</li>'

    html += '''</ul>
</body>
</html>'''

    return html, 200, {'Content-Type': 'text/html'}


@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    db = get_db()

    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    comment = data.get('comment')
    if not comment or not isinstance(comment, str) or not comment.strip():
        return jsonify({'error': 'Comment is required and must be a non-empty string'}), 400

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
        return jsonify({'error': 'Invalid input'}), 400

    rating = data.get('rating')
    if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400

    db.execute(
        'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
        (recipeId, rating)
    )
    db.commit()

    return jsonify({'message': 'Rating added successfully'}), 201


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)