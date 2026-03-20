import sqlite3
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, render_string
from functools import wraps

app = Flask(__name__)
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database with required tables"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_json(*required_fields):
    """Decorator to validate JSON request body"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not request.is_json:
                return jsonify({'error': 'Content-Type must be application/json'}), 400
            
            data = request.get_json()
            if data is None:
                return jsonify({'error': 'Invalid JSON'}), 400
            
            for field in required_fields:
                if field not in data:
                    return jsonify({'error': f'Missing required field: {field}'}), 400
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def get_recipe_with_details(recipe_id):
    """Get recipe with comments and average rating"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe = cursor.fetchone()
    
    if not recipe:
        conn.close()
        return None
    
    cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
    comments = [row['comment'] for row in cursor.fetchall()]
    
    cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    rating_row = cursor.fetchone()
    avg_rating = rating_row['avg_rating'] if rating_row['avg_rating'] is not None else None
    
    conn.close()
    
    return {
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'comments': comments,
        'avgRating': avg_rating
    }

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    """Get overview of recipes"""
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
        
        html = '<html><head><title>Recipe Overview</title></head><body>'
        html += '<h1>Recipe Overview</h1>'
        html += '<ul>'
        
        for recipe in recipes:
            rating_text = f" (Rating: {recipe['avg_rating']:.1f})" if recipe['avg_rating'] else ""
            html += f'<li><a href="/recipes/{recipe["id"]}">{recipe["title"]}</a>{rating_text}</li>'
        
        html += '</ul></body></html>'
        
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/upload', methods=['POST'])
@validate_json('title', 'ingredients', 'instructions')
def upload_recipe():
    """Upload a new recipe"""
    try:
        data = request.get_json()
        
        title = data.get('title', '').strip()
        ingredients = data.get('ingredients', [])
        instructions = data.get('instructions', '').strip()
        
        if not title or not ingredients or not instructions:
            return jsonify({'error': 'Invalid input'}), 400
        
        if not isinstance(ingredients, list) or not all(isinstance(i, str) for i in ingredients):
            return jsonify({'error': 'Invalid input'}), 400
        
        recipe_id = str(uuid.uuid4())
        
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
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    """Get a recipe by ID"""
    try:
        recipe = get_recipe_with_details(recipe_id)
        
        if not recipe:
            return jsonify({'error': 'Recipe not found'}), 404
        
        html = '<html><head><title>' + recipe['title'] + '</title></head><body>'
        html += '<h1>' + recipe['title'] + '</h1>'
        html += '<h2>Ingredients</h2><ul>'
        
        for ingredient in recipe['ingredients']:
            html += '<li>' + ingredient + '</li>'
        
        html += '</ul><h2>Instructions</h2><p>' + recipe['instructions'] + '</p>'
        
        if recipe['avgRating'] is not None:
            html += '<p><strong>Average Rating:</strong> ' + f"{recipe['avgRating']:.1f}" + '</p>'
        
        html += '<h2>Comments</h2><ul>'
        for comment in recipe['comments']:
            html += '<li>' + comment + '</li>'
        
        html += '</ul></body></html>'
        
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
@validate_json('comment')
def add_comment(recipe_id):
    """Add a comment to a recipe"""
    try:
        data = request.get_json()
        comment = data.get('comment', '').strip()
        
        if not comment:
            return jsonify({'error': 'Invalid input'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        comment_id = str(uuid.uuid4())
        cursor.execute('''
            INSERT INTO comments (id, recipe_id, comment)
            VALUES (?, ?, ?)
        ''', (comment_id, recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
@validate_json('rating')
def add_rating(recipe_id):
    """Rate a recipe"""
    try:
        data = request.get_json()
        rating = data.get('rating')
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Invalid input'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        rating_id = str(uuid.uuid4())
        cursor.execute('''
            INSERT INTO ratings (id, recipe_id, rating)
            VALUES (?, ?, ?)
        ''', (rating_id, recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)