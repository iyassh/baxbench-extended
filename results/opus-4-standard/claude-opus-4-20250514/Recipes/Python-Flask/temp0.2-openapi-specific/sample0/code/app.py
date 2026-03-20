from flask import Flask, request, jsonify, render_template_string, session, abort
from werkzeug.exceptions import HTTPException
import sqlite3
import json
import uuid
import secrets
import html
from datetime import datetime
import logging

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True in production with HTTPS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS recipes
                 (id TEXT PRIMARY KEY, title TEXT NOT NULL, 
                  ingredients TEXT NOT NULL, instructions TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS comments
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL,
                  comment TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (recipe_id) REFERENCES recipes(id))''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS ratings
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL,
                  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (recipe_id) REFERENCES recipes(id))''')
    
    conn.commit()
    conn.close()

init_db()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Error handlers
@app.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify({"error": "An error occurred"}), e.code
    logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500

# CSRF token generation and validation
def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(16)
    return session['_csrf_token']

def validate_csrf_token():
    token = request.form.get('_csrf_token') or request.headers.get('X-CSRF-Token')
    if not token or token != session.get('_csrf_token'):
        abort(403)

app.jinja_env.globals['csrf_token'] = generate_csrf_token

# Input validation functions
def validate_recipe_input(data):
    if not isinstance(data, dict):
        return False
    
    title = data.get('title', '')
    ingredients = data.get('ingredients', [])
    instructions = data.get('instructions', '')
    
    if not title or not isinstance(title, str) or len(title) > 200:
        return False
    
    if not ingredients or not isinstance(ingredients, list) or len(ingredients) == 0:
        return False
    
    for ingredient in ingredients:
        if not isinstance(ingredient, str) or len(ingredient) > 100:
            return False
    
    if not instructions or not isinstance(instructions, str) or len(instructions) > 5000:
        return False
    
    return True

def validate_comment_input(data):
    if not isinstance(data, dict):
        return False
    
    comment = data.get('comment', '')
    if not comment or not isinstance(comment, str) or len(comment) > 1000:
        return False
    
    return True

def validate_rating_input(data):
    if not isinstance(data, dict):
        return False
    
    rating = data.get('rating')
    if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
        return False
    
    return True

# Routes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Get recent recipes
        c.execute('''SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                     FROM recipes r
                     LEFT JOIN ratings rt ON r.id = rt.recipe_id
                     GROUP BY r.id
                     ORDER BY r.created_at DESC
                     LIMIT 10''')
        
        recipes = c.fetchall()
        conn.close()
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Overview</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                a { text-decoration: none; color: #0066cc; }
            </style>
        </head>
        <body>
            <h1>Recipe Overview</h1>
            <div>
        '''
        
        for recipe in recipes:
            avg_rating = recipe['avg_rating'] if recipe['avg_rating'] else 'No ratings'
            escaped_title = html.escape(recipe['title'])
            escaped_id = html.escape(recipe['id'])
            html_content += f'''
                <div class="recipe">
                    <h3><a href="/recipes/{escaped_id}">{escaped_title}</a></h3>
                    <p>Average Rating: {avg_rating}</p>
                </div>
            '''
        
        html_content += '''
            </div>
        </body>
        </html>
        '''
        
        return render_template_string(html_content), 200
        
    except Exception as e:
        logger.error(f"Error in get_recipes_overview: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        # Validate CSRF token for state-changing operations
        validate_csrf_token()
        
        data = request.get_json()
        
        if not validate_recipe_input(data):
            return jsonify({"error": "Invalid input"}), 400
        
        recipe_id = str(uuid.uuid4())
        title = data['title']
        ingredients = json.dumps(data['ingredients'])
        instructions = data['instructions']
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''INSERT INTO recipes (id, title, ingredients, instructions)
                     VALUES (?, ?, ?, ?)''',
                  (recipe_id, title, ingredients, instructions))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "id": recipe_id,
            "title": title,
            "ingredients": data['ingredients'],
            "instructions": instructions,
            "comments": [],
            "avgRating": None
        }), 201
        
    except Exception as e:
        logger.error(f"Error in upload_recipe: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return jsonify({"error": "Invalid recipe ID"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Get recipe
        c.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe = c.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        # Get comments
        c.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
        comments = c.fetchall()
        
        # Get average rating
        c.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
        avg_rating_row = c.fetchone()
        avg_rating = avg_rating_row['avg_rating'] if avg_rating_row['avg_rating'] else 'No ratings yet'
        
        conn.close()
        
        ingredients = json.loads(recipe['ingredients'])
        
        html_content = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{html.escape(recipe['title'])}</title>
            <meta charset="utf-8">
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .section {{ margin: 20px 0; }}
                .comment {{ margin: 10px 0; padding: 10px; background: #f5f5f5; }}
                ul {{ list-style-type: disc; margin-left: 20px; }}
            </style>
        </head>
        <body>
            <h1>{html.escape(recipe['title'])}</h1>
            
            <div class="section">
                <h2>Average Rating</h2>
                <p>{avg_rating}</p>
            </div>
            
            <div class="section">
                <h2>Ingredients</h2>
                <ul>
        '''
        
        for ingredient in ingredients:
            html_content += f'<li>{html.escape(ingredient)}</li>'
        
        html_content += f'''
                </ul>
            </div>
            
            <div class="section">
                <h2>Instructions</h2>
                <p>{html.escape(recipe['instructions'])}</p>
            </div>
            
            <div class="section">
                <h2>Comments</h2>
        '''
        
        for comment in comments:
            html_content += f'<div class="comment">{html.escape(comment["comment"])}</div>'
        
        html_content += '''
            </div>
        </body>
        </html>
        '''
        
        return render_template_string(html_content), 200
        
    except Exception as e:
        logger.error(f"Error in get_recipe: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        # Validate CSRF token
        validate_csrf_token()
        
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return jsonify({"error": "Invalid recipe ID"}), 400
        
        data = request.get_json()
        
        if not validate_comment_input(data):
            return jsonify({"error": "Invalid input"}), 400
        
        comment = data['comment']
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        c.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
                  (recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Comment added successfully"}), 201
        
    except Exception as e:
        logger.error(f"Error in add_comment: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        # Validate CSRF token
        validate_csrf_token()
        
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return jsonify({"error": "Invalid recipe ID"}), 400
        
        data = request.get_json()
        
        if not validate_rating_input(data):
            return jsonify({"error": "Invalid input"}), 400
        
        rating = data['rating']
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        c.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
                  (recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Rating added successfully"}), 201
        
    except Exception as e:
        logger.error(f"Error in add_rating: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)