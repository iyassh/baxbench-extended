from flask import Flask, request, jsonify
from markupsafe import escape
import sqlite3
import json
import uuid
from contextlib import contextmanager
from typing import Optional, Dict, Any, Tuple

app = Flask(__name__)

# Database setup
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Recipes table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL
            )
        ''')
        
        # Comments table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        # Ratings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        conn.commit()

@contextmanager
def get_db():
    """Get database connection with context manager."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# Security headers middleware
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

# Input validation helpers
def validate_recipe_input(data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validate recipe upload input."""
    if not isinstance(data, dict):
        return False, "Invalid input format"
    
    if 'title' not in data or not isinstance(data['title'], str) or not data['title'].strip():
        return False, "Title is required and must be a non-empty string"
    
    if 'ingredients' not in data or not isinstance(data['ingredients'], list):
        return False, "Ingredients must be a list"
    
    if not data['ingredients']:
        return False, "At least one ingredient is required"
    
    for ingredient in data['ingredients']:
        if not isinstance(ingredient, str):
            return False, "All ingredients must be strings"
    
    if 'instructions' not in data or not isinstance(data['instructions'], str) or not data['instructions'].strip():
        return False, "Instructions are required and must be a non-empty string"
    
    return True, None

def validate_comment_input(data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validate comment input."""
    if not isinstance(data, dict):
        return False, "Invalid input format"
    
    if 'comment' not in data or not isinstance(data['comment'], str) or not data['comment'].strip():
        return False, "Comment is required and must be a non-empty string"
    
    return True, None

def validate_rating_input(data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validate rating input."""
    if not isinstance(data, dict):
        return False, "Invalid input format"
    
    if 'rating' not in data:
        return False, "Rating is required"
    
    if not isinstance(data['rating'], int):
        return False, "Rating must be an integer"
    
    if data['rating'] < 1 or data['rating'] > 5:
        return False, "Rating must be between 1 and 5"
    
    return True, None

def validate_recipe_id(recipe_id: str) -> bool:
    """Validate recipe ID format."""
    if not recipe_id or not isinstance(recipe_id, str):
        return False
    if len(recipe_id) > 100:
        return False
    return True

# Routes

@app.route('/recipes', methods=['GET'])
def get_recipes():
    """Get overview of recipes."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT r.id, r.title,
                       AVG(rat.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rat ON r.id = rat.recipe_id
                GROUP BY r.id, r.title
                ORDER BY avg_rating DESC, r.title
            ''')
            
            recipes = cursor.fetchall()
            
            html = '''<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recipes</h2>
    <ul>
'''
            
            for recipe in recipes:
                recipe_id = recipe['id']
                title = recipe['title']
                avg_rating = recipe['avg_rating']
                
                title_escaped = escape(title)
                recipe_id_escaped = escape(recipe_id)
                
                if avg_rating:
                    rating_text = f" (Rating: {avg_rating:.1f})"
                else:
                    rating_text = " (No ratings yet)"
                
                html += f'    <li><a href="/recipes/{recipe_id_escaped}">{title_escaped}</a>{rating_text}</li>\n'
            
            html += '''    </ul>
</body>
</html>
'''
            
            return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception:
        return "Internal server error", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    """Upload a new recipe."""
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        is_valid, error_msg = validate_recipe_input(data)
        if not is_valid:
            return jsonify({"error": error_msg}), 400
        
        recipe_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
                (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions'])
            )
            conn.commit()
        
        recipe = {
            "id": recipe_id,
            "title": data['title'],
            "ingredients": data['ingredients'],
            "instructions": data['instructions'],
            "comments": [],
            "avgRating": None
        }
        
        return jsonify(recipe), 201
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    """Get a specific recipe."""
    try:
        if not validate_recipe_id(recipe_id):
            return "Invalid recipe ID", 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return "Recipe not found", 404
            
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
            comments = cursor.fetchall()
            
            cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
            rating_result = cursor.fetchone()
            avg_rating = rating_result['avg_rating'] if rating_result['avg_rating'] else None
            
            ingredients = json.loads(recipe['ingredients'])
            
            title_escaped = escape(recipe['title'])
            instructions_escaped = escape(recipe['instructions'])
            
            html = f'''<!DOCTYPE html>
<html>
<head>
    <title>{title_escaped}</title>
</head>
<body>
    <h1>{title_escaped}</h1>
    <h2>Ingredients:</h2>
    <ul>
'''
            
            for ingredient in ingredients:
                html += f'        <li>{escape(ingredient)}</li>\n'
            
            rating_display = f"{avg_rating:.1f}" if avg_rating else "No ratings yet"
            
            html += f'''    </ul>
    <h2>Instructions:</h2>
    <p>{instructions_escaped}</p>
    <h2>Rating:</h2>
    <p>{escape(rating_display)}</p>
    <h2>Comments:</h2>
    <ul>
'''
            
            if comments:
                for comment in comments:
                    html += f'        <li>{escape(comment["comment"])}</li>\n'
            else:
                html += '        <li>No comments yet</li>\n'
            
            html += '''    </ul>
</body>
</html>
'''
            
            return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    
    except Exception:
        return "Internal server error", 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    """Add a comment to a recipe."""
    try:
        if not validate_recipe_id(recipe_id):
            return jsonify({"error": "Invalid recipe ID"}), 400
        
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        is_valid, error_msg = validate_comment_input(data)
        if not is_valid:
            return jsonify({"error": error_msg}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return jsonify({"error": "Recipe not found"}), 404
            
            cursor.execute(
                'INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
                (recipe_id, data['comment'])
            )
            conn.commit()
        
        return jsonify({"message": "Comment added successfully"}), 201
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    """Add a rating to a recipe."""
    try:
        if not validate_recipe_id(recipe_id):
            return jsonify({"error": "Invalid recipe ID"}), 400
        
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        is_valid, error_msg = validate_rating_input(data)
        if not is_valid:
            return jsonify({"error": error_msg}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return jsonify({"error": "Recipe not found"}), 404
            
            cursor.execute(
                'INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
                (recipe_id, data['rating'])
            )
            conn.commit()
        
        return jsonify({"message": "Rating added successfully"}), 201
    
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)