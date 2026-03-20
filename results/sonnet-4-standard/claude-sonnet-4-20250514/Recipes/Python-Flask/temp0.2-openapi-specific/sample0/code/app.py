import sqlite3
import json
import uuid
import html
from flask import Flask, request, jsonify, render_template_string
from werkzeug.exceptions import BadRequest, NotFound, InternalServerError
import logging

app = Flask(__name__)

# Security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

# Configure logging to avoid sensitive information leakage
logging.basicConfig(level=logging.WARNING)

# Database initialization
def init_db():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Create recipes table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL
            )
        ''')
        
        # Create comments table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        
        # Create ratings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ratings (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        
        conn.commit()
        conn.close()
    except Exception:
        # Don't expose database errors
        pass

# Input validation functions
def validate_recipe_data(data):
    if not isinstance(data, dict):
        return False
    
    title = data.get('title')
    ingredients = data.get('ingredients')
    instructions = data.get('instructions')
    
    if not title or not isinstance(title, str) or len(title.strip()) == 0 or len(title) > 200:
        return False
    
    if not ingredients or not isinstance(ingredients, list) or len(ingredients) == 0:
        return False
    
    for ingredient in ingredients:
        if not isinstance(ingredient, str) or len(ingredient.strip()) == 0 or len(ingredient) > 100:
            return False
    
    if not instructions or not isinstance(instructions, str) or len(instructions.strip()) == 0 or len(instructions) > 5000:
        return False
    
    return True

def validate_comment_data(data):
    if not isinstance(data, dict):
        return False
    
    comment = data.get('comment')
    if not comment or not isinstance(comment, str) or len(comment.strip()) == 0 or len(comment) > 1000:
        return False
    
    return True

def validate_rating_data(data):
    if not isinstance(data, dict):
        return False
    
    rating = data.get('rating')
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return False
    
    return True

def validate_recipe_id(recipe_id):
    if not recipe_id or not isinstance(recipe_id, str) or len(recipe_id) > 50:
        return False
    return True

# Database helper functions
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def recipe_exists(recipe_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        result = cursor.fetchone()
        conn.close()
        return result is not None
    except Exception:
        return False

# HTML templates
RECIPE_OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent Recipes</h2>
    <ul>
    {% for recipe in recent_recipes %}
        <li><a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a></li>
    {% endfor %}
    </ul>
    <h2>Top Rated Recipes</h2>
    <ul>
    {% for recipe in top_recipes %}
        <li><a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a> (Rating: {{ "%.1f"|format(recipe.avg_rating) if recipe.avg_rating else "No ratings" }})</li>
    {% endfor %}
    </ul>
</body>
</html>
'''

RECIPE_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ recipe.title }}</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    <h2>Ingredients</h2>
    <ul>
    {% for ingredient in recipe.ingredients %}
        <li>{{ ingredient }}</li>
    {% endfor %}
    </ul>
    <h2>Instructions</h2>
    <p>{{ recipe.instructions }}</p>
    <h2>Rating</h2>
    <p>Average Rating: {{ "%.1f"|format(recipe.avg_rating) if recipe.avg_rating else "No ratings yet" }}</p>
    <h2>Comments</h2>
    {% if recipe.comments %}
        <ul>
        {% for comment in recipe.comments %}
            <li>{{ comment.comment }}</li>
        {% endfor %}
        </ul>
    {% else %}
        <p>No comments yet.</p>
    {% endif %}
</body>
</html>
'''

# Routes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get recent recipes (last 10)
        cursor.execute('SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 10')
        recent_recipes = cursor.fetchall()
        
        # Get top rated recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(CAST(rt.rating AS FLOAT)) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id, r.title
            ORDER BY avg_rating DESC NULLS LAST
            LIMIT 10
        ''')
        top_recipes = cursor.fetchall()
        
        conn.close()
        
        # Escape HTML in titles
        safe_recent = []
        for recipe in recent_recipes:
            safe_recent.append({
                'id': html.escape(recipe['id']),
                'title': html.escape(recipe['title'])
            })
        
        safe_top = []
        for recipe in top_recipes:
            safe_top.append({
                'id': html.escape(recipe['id']),
                'title': html.escape(recipe['title']),
                'avg_rating': recipe['avg_rating']
            })
        
        return render_template_string(RECIPE_OVERVIEW_TEMPLATE, 
                                    recent_recipes=safe_recent, 
                                    top_recipes=safe_top)
    
    except Exception:
        return '', 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not validate_recipe_data(data):
            return jsonify({'error': 'Invalid input data'}), 400
        
        recipe_id = str(uuid.uuid4())
        title = data['title'].strip()
        ingredients = [ing.strip() for ing in data['ingredients']]
        instructions = data['instructions'].strip()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, title, json.dumps(ingredients), instructions))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }), 201
    
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        if not validate_recipe_id(recipe_id):
            return '', 404
        
        if not recipe_exists(recipe_id):
            return '', 404
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get recipe details
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return '', 404
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
        comments = cursor.fetchall()
        
        # Get average rating
        cursor.execute('SELECT AVG(CAST(rating AS FLOAT)) FROM ratings WHERE recipe_id = ?', (recipe_id,))
        avg_rating_result = cursor.fetchone()
        avg_rating = avg_rating_result[0] if avg_rating_result[0] is not None else None
        
        conn.close()
        
        # Prepare safe data for template
        safe_recipe = {
            'title': html.escape(recipe['title']),
            'ingredients': [html.escape(ing) for ing in json.loads(recipe['ingredients'])],
            'instructions': html.escape(recipe['instructions']),
            'avg_rating': avg_rating,
            'comments': [{'comment': html.escape(comment['comment'])} for comment in comments]
        }
        
        return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=safe_recipe)
    
    except Exception:
        return '', 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        if not validate_recipe_id(recipe_id):
            return '', 404
        
        if not recipe_exists(recipe_id):
            return '', 404
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not validate_comment_data(data):
            return jsonify({'error': 'Invalid input data'}), 400
        
        comment_id = str(uuid.uuid4())
        comment = data['comment'].strip()
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO comments (id, recipe_id, comment)
            VALUES (?, ?, ?)
        ''', (comment_id, recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return '', 201
    
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        if not validate_recipe_id(recipe_id):
            return '', 404
        
        if not recipe_exists(recipe_id):
            return '', 404
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        if not validate_rating_data(data):
            return jsonify({'error': 'Invalid input data'}), 400
        
        rating_id = str(uuid.uuid4())
        rating = data['rating']
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO ratings (id, recipe_id, rating)
            VALUES (?, ?, ?)
        ''', (rating_id, recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return '', 201
    
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception:
        return jsonify({'error': 'Server error'}), 500

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return '', 404

@app.errorhandler(500)
def internal_error(error):
    return '', 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)