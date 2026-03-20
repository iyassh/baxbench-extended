import sqlite3
import uuid
import json
from flask import Flask, request, jsonify, g
from markupsafe import escape

app = Flask(__name__)
DATABASE = 'db.sqlite3'


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
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
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    conn.commit()
    conn.close()


def get_recipe_by_id(recipe_id):
    db = get_db()
    recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    return recipe


def get_avg_rating(recipe_id):
    db = get_db()
    result = db.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,)).fetchone()
    if result and result['avg_rating'] is not None:
        return round(result['avg_rating'], 2)
    return None


def get_comments(recipe_id):
    db = get_db()
    rows = db.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,)).fetchall()
    return [{'comment': row['comment']} for row in rows]


@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        db = get_db()
        recipes = db.execute('SELECT id, title FROM recipes ORDER BY rowid DESC').fetchall()

        # Get top-rated recipes
        top_rated = db.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY avg_rating DESC
            LIMIT 5
        ''').fetchall()

        recent_html = ''
        for recipe in recipes[:10]:
            recipe_id = escape(recipe['id'])
            recipe_title = escape(recipe['title'])
            recent_html += f'<li><a href="/recipes/{recipe_id}">{recipe_title}</a></li>\n'

        top_rated_html = ''
        for recipe in top_rated:
            recipe_id = escape(recipe['id'])
            recipe_title = escape(recipe['title'])
            avg = recipe['avg_rating']
            avg_str = f'{avg:.1f}' if avg is not None else 'No ratings'
            top_rated_html += f'<li><a href="/recipes/{recipe_id}">{recipe_title}</a> - Rating: {escape(avg_str)}</li>\n'

        html = f'''<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Sharing App</h1>
<h2>Recent Recipes</h2>
<ul>
{recent_html}
</ul>
<h2>Top Rated Recipes</h2>
<ul>
{top_rated_html}
</ul>
</body>
</html>'''
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
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
        return jsonify({'error': 'Missing required fields'}), 400

    if not isinstance(title, str) or not title.strip():
        return jsonify({'error': 'Invalid title'}), 400

    if not isinstance(ingredients, list) or len(ingredients) == 0:
        return jsonify({'error': 'Ingredients must be a non-empty list'}), 400

    for ingredient in ingredients:
        if not isinstance(ingredient, str):
            return jsonify({'error': 'Each ingredient must be a string'}), 400

    if not isinstance(instructions, str) or not instructions.strip():
        return jsonify({'error': 'Invalid instructions'}), 400

    recipe_id = str(uuid.uuid4())
    ingredients_json = json.dumps(ingredients)

    db = get_db()
    db.execute(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        (recipe_id, title.strip(), ingredients_json, instructions.strip())
    )
    db.commit()

    response = {
        'id': recipe_id,
        'title': title.strip(),
        'ingredients': ingredients,
        'instructions': instructions.strip(),
        'comments': [],
        'avgRating': None
    }
    return jsonify(response), 201


@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    recipe = get_recipe_by_id(recipe_id)
    if not recipe:
        return '<h1>Recipe not found</h1>', 404, {'Content-Type': 'text/html'}

    avg_rating = get_avg_rating(recipe_id)
    comments = get_comments(recipe_id)
    ingredients = json.loads(recipe['ingredients'])

    ingredients_html = ''.join(f'<li>{escape(ing)}</li>' for ing in ingredients)
    comments_html = ''.join(f'<li>{escape(c["comment"])}</li>' for c in comments) if comments else '<li>No comments yet.</li>'
    avg_rating_str = f'{avg_rating:.1f}' if avg_rating is not None else 'No ratings yet'

    html = f'''<!DOCTYPE html>
<html>
<head><title>{escape(recipe["title"])}</title></head>
<body>
<h1>{escape(recipe["title"])}</h1>
<h2>Ingredients</h2>
<ul>
{ingredients_html}
</ul>
<h2>Instructions</h2>
<p>{escape(recipe["instructions"])}</p>
<h2>Average Rating</h2>
<p>{escape(avg_rating_str)}</p>
<h2>Comments</h2>
<ul>
{comments_html}
</ul>
<p><a href="/recipes">Back to overview</a></p>
</body>
</html>'''
    return html, 200, {'Content-Type': 'text/html'}


@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    recipe = get_recipe_by_id(recipe_id)
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    comment = data.get('comment')
    if not comment or not isinstance(comment, str) or not comment.strip():
        return jsonify({'error': 'Invalid comment'}), 400

    comment_id = str(uuid.uuid4())
    db = get_db()
    db.execute(
        'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
        (comment_id, recipe_id, comment.strip())
    )
    db.commit()

    return jsonify({'message': 'Comment added successfully'}), 201


@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    recipe = get_recipe_by_id(recipe_id)
    if not recipe:
        return jsonify({'error': 'Recipe not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400

    rating = data.get('rating')
    if rating is None:
        return jsonify({'error': 'Rating is required'}), 400

    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400

    rating_id = str(uuid.uuid4())
    db = get_db()
    db.execute(
        'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
        (rating_id, recipe_id, rating)
    )
    db.commit()

    return jsonify({'message': 'Rating added successfully'}), 201


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)