import sqlite3
import uuid
import json
from flask import Flask, request, jsonify, g

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
    if recipe is None:
        return None
    
    comments = db.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,)).fetchall()
    ratings = db.execute('SELECT rating FROM ratings WHERE recipe_id = ?', (recipe_id,)).fetchall()
    
    avg_rating = None
    if ratings:
        avg_rating = sum(r['rating'] for r in ratings) / len(ratings)
    
    return {
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'comments': [{'comment': c['comment']} for c in comments],
        'avgRating': avg_rating
    }

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        db = get_db()
        recipes = db.execute('SELECT id, title FROM recipes').fetchall()
        
        # Get top-rated recipes
        top_rated = db.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY avg_rating DESC
            LIMIT 5
        ''').fetchall()
        
        recent_recipes = db.execute('SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 5').fetchall()
        
        html = '''<!DOCTYPE html>
<html>
<head><title>Recipe Overview</title></head>
<body>
<h1>Recipe Sharing App</h1>
<h2>Recent Recipes</h2>
<ul>
'''
        for recipe in recent_recipes:
            html += f'<li><a href="/recipes/{recipe["id"]}">{recipe["title"]}</a></li>\n'
        
        html += '''</ul>
<h2>Top Rated Recipes</h2>
<ul>
'''
        for recipe in top_rated:
            avg = f'{recipe["avg_rating"]:.1f}' if recipe["avg_rating"] else 'No ratings'
            html += f'<li><a href="/recipes/{recipe["id"]}">{recipe["title"]}</a> - Rating: {avg}</li>\n'
        
        html += '''</ul>
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
    
    if not isinstance(ingredients, list):
        return jsonify({'error': 'Ingredients must be an array'}), 400
    
    recipe_id = str(uuid.uuid4())
    
    db = get_db()
    db.execute(
        'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
        (recipe_id, title, json.dumps(ingredients), instructions)
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

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    recipe = get_recipe_by_id(recipe_id)
    if recipe is None:
        return 'Recipe not found', 404
    
    ingredients_html = ''.join(f'<li>{ing}</li>' for ing in recipe['ingredients'])
    comments_html = ''.join(f'<li>{c["comment"]}</li>' for c in recipe['comments'])
    avg_rating = f'{recipe["avgRating"]:.1f}' if recipe['avgRating'] is not None else 'No ratings yet'
    
    html = f'''<!DOCTYPE html>
<html>
<head><title>{recipe["title"]}</title></head>
<body>
<h1>{recipe["title"]}</h1>
<p><strong>Average Rating:</strong> {avg_rating}</p>
<h2>Ingredients</h2>
<ul>
{ingredients_html}
</ul>
<h2>Instructions</h2>
<p>{recipe["instructions"]}</p>
<h2>Comments</h2>
<ul>
{comments_html if comments_html else '<li>No comments yet</li>'}
</ul>
<p><a href="/recipes">Back to overview</a></p>
</body>
</html>'''
    
    return html, 200, {'Content-Type': 'text/html'}

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    db = get_db()
    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    if recipe is None:
        return jsonify({'error': 'Recipe not found'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid input'}), 400
    
    comment = data.get('comment')
    if not comment:
        return jsonify({'error': 'Comment is required'}), 400
    
    comment_id = str(uuid.uuid4())
    db.execute(
        'INSERT INTO comments (id, recipe_id, comment) VALUES (?, ?, ?)',
        (comment_id, recipe_id, comment)
    )
    db.commit()
    
    return jsonify({'message': 'Comment added successfully'}), 201

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    db = get_db()
    recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    if recipe is None:
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
    db.execute(
        'INSERT INTO ratings (id, recipe_id, rating) VALUES (?, ?, ?)',
        (rating_id, recipe_id, rating)
    )
    db.commit()
    
    return jsonify({'message': 'Rating added successfully'}), 201

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)