import sqlite3
import json
import os
from datetime import datetime
from functools import wraps
from html import escape
from flask import Flask, request, jsonify, render_template_string
import secrets

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Database initialization
def init_db():
    if not os.path.exists('db.sqlite3'):
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE comments (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE ratings (
                id TEXT PRIMARY KEY,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE csrf_tokens (
                token TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()

def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def generate_csrf_token():
    token = secrets.token_urlsafe(32)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO csrf_tokens (token) VALUES (?)', (token,))
    conn.commit()
    conn.close()
    return token

def verify_csrf_token(token):
    if not token:
        return False
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT token FROM csrf_tokens WHERE token = ?', (token,))
    result = cursor.fetchone()
    conn.close()
    return result is not None

def require_csrf(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('X-CSRF-Token') or request.json.get('csrf_token') if request.is_json else None
        if not token or not verify_csrf_token(token):
            return jsonify({'error': 'Invalid CSRF token'}), 403
        return f(*args, **kwargs)
    return decorated_function

def get_recipe_with_details(recipe_id):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe = cursor.fetchone()
    
    if not recipe:
        conn.close()
        return None
    
    cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
    comments = [{'comment': escape(row['comment'])} for row in cursor.fetchall()]
    
    cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    rating_row = cursor.fetchone()
    avg_rating = rating_row['avg_rating'] if rating_row['avg_rating'] else None
    
    conn.close()
    
    return {
        'id': recipe['id'],
        'title': escape(recipe['title']),
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': escape(recipe['instructions']),
        'comments': comments,
        'avgRating': round(avg_rating, 1) if avg_rating else None
    }

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT r.id, r.title, AVG(ra.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings ra ON r.id = ra.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 10
        ''')
        recipes = cursor.fetchall()
        conn.close()
        
        recipe_list = []
        for recipe in recipes:
            recipe_list.append({
                'id': recipe['id'],
                'title': escape(recipe['title']),
                'avgRating': round(recipe['avg_rating'], 1) if recipe['avg_rating'] else None
            })
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Sharing App</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recipe { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
                a { color: #0066cc; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Recipe Sharing App</h1>
            <h2>Recent Recipes</h2>
        '''
        
        for recipe in recipe_list:
            rating_text = f"Rating: {recipe['avgRating']}/5" if recipe['avgRating'] else "No ratings yet"
            html_content += f'''
            <div class="recipe">
                <h3><a href="/recipes/{recipe['id']}">{recipe['title']}</a></h3>
                <p>{rating_text}</p>
            </div>
            '''
        
        html_content += '''
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/upload', methods=['POST'])
@require_csrf
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        title = data.get('title', '').strip()
        ingredients = data.get('ingredients', [])
        instructions = data.get('instructions', '').strip()
        
        if not title or not isinstance(ingredients, list) or not ingredients or not instructions:
            return jsonify({'error': 'Missing or invalid required fields'}), 400
        
        if not all(isinstance(ing, str) and ing.strip() for ing in ingredients):
            return jsonify({'error': 'Invalid ingredients format'}), 400
        
        if len(title) > 500 or len(instructions) > 5000:
            return jsonify({'error': 'Input too long'}), 400
        
        recipe_id = secrets.token_urlsafe(16)
        
        conn = get_db()
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
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        if not recipe_id or len(recipe_id) > 100:
            return jsonify({'error': 'Invalid recipe ID'}), 404
        
        recipe = get_recipe_with_details(recipe_id)
        
        if not recipe:
            return jsonify({'error': 'Recipe not found'}), 404
        
        html_content = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{recipe['title']}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                .recipe {{ border: 1px solid #ddd; padding: 20px; }}
                .ingredients {{ margin: 20px 0; }}
                .comments {{ margin: 20px 0; }}
                .comment {{ border-left: 3px solid #ddd; padding: 10px; margin: 10px 0; }}
                .rating {{ font-size: 18px; font-weight: bold; }}
            </style>
        </head>
        <body>
            <a href="/recipes">Back to recipes</a>
            <div class="recipe">
                <h1>{recipe['title']}</h1>
                <div class="rating">
                    Rating: {recipe['avgRating'] if recipe['avgRating'] else 'No ratings yet'}
                </div>
                <div class="ingredients">
                    <h2>Ingredients</h2>
                    <ul>
        '''
        
        for ingredient in recipe['ingredients']:
            html_content += f'<li>{escape(ingredient)}</li>'
        
        html_content += f'''
                    </ul>
                </div>
                <div class="instructions">
                    <h2>Instructions</h2>
                    <p>{recipe['instructions']}</p>
                </div>
                <div class="comments">
                    <h2>Comments</h2>
        '''
        
        for comment in recipe['comments']:
            html_content += f'<div class="comment">{comment["comment"]}</div>'
        
        html_content += '''
                </div>
            </div>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
@require_csrf
def add_comment(recipe_id):
    try:
        if not recipe_id or len(recipe_id) > 100:
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        comment = data.get('comment', '').strip()
        
        if not comment or len(comment) > 5000:
            return jsonify({'error': 'Invalid comment'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        comment_id = secrets.token_urlsafe(16)
        cursor.execute('''
            INSERT INTO comments (id, recipe_id, comment)
            VALUES (?, ?, ?)
        ''', (comment_id, recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
@require_csrf
def add_rating(recipe_id):
    try:
        if not recipe_id or len(recipe_id) > 100:
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        rating = data.get('rating')
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Invalid rating'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        rating_id = secrets.token_urlsafe(16)
        cursor.execute('''
            INSERT INTO ratings (id, recipe_id, rating)
            VALUES (?, ?, ?)
        ''', (rating_id, recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/csrf-token', methods=['GET'])
def get_csrf_token():
    try:
        token = generate_csrf_token()
        return jsonify({'csrf_token': token}), 200
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)