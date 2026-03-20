import sqlite3
import json
import uuid
import os
from flask import Flask, request, jsonify, g
from markupsafe import escape
import logging

app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1MB max request size

# Configure logging to avoid information disclosure
logging.basicConfig(level=logging.WARNING, format='%(levelname)s: %(message)s')

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# Database setup
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
    with app.app_context():
        db = get_db()
        db.executescript('''
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            );
            
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            );
        ''')
        db.commit()

# Input validation helpers
def validate_recipe_data(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    required_fields = ['title', 'ingredients', 'instructions']
    for field in required_fields:
        if field not in data:
            return False, f"Missing required field: {field}"
    
    # Validate title
    if not isinstance(data['title'], str) or not data['title'].strip():
        return False, "Title must be a non-empty string"
    if len(data['title']) > 200:
        return False, "Title too long"
    
    # Validate ingredients
    if not isinstance(data['ingredients'], list) or len(data['ingredients']) == 0:
        return False, "Ingredients must be a non-empty list"
    if len(data['ingredients']) > 50:
        return False, "Too many ingredients"
    
    for ingredient in data['ingredients']:
        if not isinstance(ingredient, str) or not ingredient.strip():
            return False, "All ingredients must be non-empty strings"
        if len(ingredient) > 100:
            return False, "Ingredient name too long"
    
    # Validate instructions
    if not isinstance(data['instructions'], str) or not data['instructions'].strip():
        return False, "Instructions must be a non-empty string"
    if len(data['instructions']) > 5000:
        return False, "Instructions too long"
    
    return True, None

def validate_comment_data(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    if 'comment' not in data:
        return False, "Missing required field: comment"
    
    if not isinstance(data['comment'], str) or not data['comment'].strip():
        return False, "Comment must be a non-empty string"
    
    if len(data['comment']) > 1000:
        return False, "Comment too long"
    
    return True, None

def validate_rating_data(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    if 'rating' not in data:
        return False, "Missing required field: rating"
    
    if not isinstance(data['rating'], int) or data['rating'] < 1 or data['rating'] > 5:
        return False, "Rating must be an integer between 1 and 5"
    
    return True, None

def validate_uuid(uuid_string):
    if not isinstance(uuid_string, str):
        return False
    try:
        uuid.UUID(uuid_string)
        return True
    except (ValueError, TypeError):
        return False

# HTML generation with proper escaping
def build_html_page(title, body_content):
    title_safe = escape(title) if title else "Recipe App"
    return f'''<!DOCTYPE html>
<html>
<head>
    <title>{title_safe}</title>
    <meta charset="utf-8">
</head>
<body>
{body_content}
</body>
</html>'''

def generate_recipes_overview_html(recipes):
    content_parts = ['<h1>Recipe Overview</h1>', '<h2>Recent Recipes</h2>']
    
    if recipes:
        content_parts.append('<ul>')
        for recipe in recipes:
            title_safe = escape(recipe['title'])
            id_safe = escape(recipe['id'])
            
            if recipe['avg_rating']:
                rating_text = f' - Rating: {recipe["avg_rating"]:.1f}/5 ({recipe["rating_count"]} ratings)'
            else:
                rating_text = ' - No ratings yet'
            
            content_parts.append(f'<li><a href="/recipes/{id_safe}">{title_safe}</a>{rating_text}</li>')
        content_parts.append('</ul>')
    else:
        content_parts.append('<p>No recipes available yet.</p>')
    
    return build_html_page('Recipe Overview', '\n'.join(content_parts))

def generate_recipe_detail_html(recipe, ingredients, comments, avg_rating, rating_count):
    title_safe = escape(recipe['title'])
    instructions_safe = escape(recipe['instructions'])
    
    content_parts = [f'<h1>{title_safe}</h1>']
    
    # Ingredients
    content_parts.extend(['<h2>Ingredients</h2>', '<ul>'])
    for ingredient in ingredients:
        content_parts.append(f'<li>{escape(ingredient)}</li>')
    content_parts.append('</ul>')
    
    # Instructions  
    content_parts.extend(['<h2>Instructions</h2>', f'<p>{instructions_safe}</p>'])
    
    # Rating
    content_parts.append('<h2>Rating</h2>')
    if avg_rating:
        rating_text = f'Average Rating: {avg_rating:.1f}/5 ({rating_count} ratings)'
        content_parts.append(f'<p>{rating_text}</p>')
    else:
        content_parts.append('<p>No ratings yet</p>')
    
    # Comments
    content_parts.append('<h2>Comments</h2>')
    if comments:
        content_parts.append('<ul>')
        for comment in comments:
            content_parts.append(f'<li>{escape(comment["comment"])}</li>')
        content_parts.append('</ul>')
    else:
        content_parts.append('<p>No comments yet</p>')
    
    content_parts.append('<p><a href="/recipes">Back to Recipe Overview</a></p>')
    
    return build_html_page(recipe['title'], '\n'.join(content_parts))

# Routes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        db = get_db()
        recipes = db.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating, COUNT(rt.rating) as rating_count
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id, r.title
            ORDER BY r.rowid DESC
            LIMIT 10
        ''').fetchall()
        
        html_content = generate_recipes_overview_html(recipes)
        return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}
        
    except Exception as e:
        app.logger.error("Database error in get_recipes_overview")
        return "Internal Server Error", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        valid, error_msg = validate_recipe_data(data)
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        recipe_id = str(uuid.uuid4())
        title = data['title'].strip()
        ingredients_json = json.dumps(data['ingredients'])
        instructions = data['instructions'].strip()
        
        db = get_db()
        db.execute(
            'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
            (recipe_id, title, ingredients_json, instructions)
        )
        db.commit()
        
        return jsonify({
            "id": recipe_id,
            "title": title,
            "ingredients": data['ingredients'],
            "instructions": instructions,
            "comments": [],
            "avgRating": None
        }), 201
        
    except Exception as e:
        app.logger.error("Database error in upload_recipe")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        if not validate_uuid(recipe_id):
            return "Recipe not found", 404
        
        db = get_db()
        recipe = db.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
        
        if recipe is None:
            return "Recipe not found", 404
        
        comments = db.execute(
            'SELECT comment FROM comments WHERE recipe_id = ? ORDER BY id',
            (recipe_id,)
        ).fetchall()
        
        ratings = db.execute(
            'SELECT AVG(rating) as avg_rating, COUNT(rating) as count FROM ratings WHERE recipe_id = ?',
            (recipe_id,)
        ).fetchone()
        
        avg_rating = ratings['avg_rating'] if ratings['avg_rating'] else None
        rating_count = ratings['count'] if ratings else 0
        
        try:
            ingredients = json.loads(recipe['ingredients'])
        except (ValueError, TypeError):
            app.logger.error("Data integrity error in database")
            return "Internal Server Error", 500
        
        html_content = generate_recipe_detail_html(recipe, ingredients, comments, avg_rating, rating_count)
        return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}
        
    except Exception as e:
        app.logger.error("Database error in get_recipe")
        return "Internal Server Error", 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        if not validate_uuid(recipe_id):
            return jsonify({"error": "Recipe not found"}), 404
        
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        valid, error_msg = validate_comment_data(data)
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        db = get_db()
        
        recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404
        
        comment = data['comment'].strip()
        
        db.execute(
            'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
            (recipe_id, comment)
        )
        db.commit()
        
        return jsonify({"message": "Comment added successfully"}), 201
        
    except Exception as e:
        app.logger.error("Database error in add_comment")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        if not validate_uuid(recipe_id):
            return jsonify({"error": "Recipe not found"}), 404
        
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        try:
            data = request.get_json()
        except Exception:
            return jsonify({"error": "Invalid JSON"}), 400
        
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        valid, error_msg = validate_rating_data(data)
        if not valid:
            return jsonify({"error": error_msg}), 400
        
        db = get_db()
        
        recipe = db.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404
        
        rating = data['rating']
        
        db.execute(
            'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
            (recipe_id, rating)
        )
        db.commit()
        
        return jsonify({"message": "Rating added successfully"}), 201
        
    except Exception as e:
        app.logger.error("Database error in add_rating")
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)