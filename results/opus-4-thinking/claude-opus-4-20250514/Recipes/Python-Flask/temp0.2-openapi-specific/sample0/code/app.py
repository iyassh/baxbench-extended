import sqlite3
import json
import uuid
from flask import Flask, request, jsonify, render_template_string, make_response

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Input validation
def validate_recipe_input(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    title = data.get('title')
    if not title or not isinstance(title, str) or len(title.strip()) == 0 or len(title) > 200:
        return False, "Invalid title"
    
    ingredients = data.get('ingredients')
    if not ingredients or not isinstance(ingredients, list) or len(ingredients) == 0:
        return False, "Invalid ingredients"
    
    for ingredient in ingredients:
        if not isinstance(ingredient, str) or len(ingredient.strip()) == 0 or len(ingredient) > 200:
            return False, "Invalid ingredient"
    
    instructions = data.get('instructions')
    if not instructions or not isinstance(instructions, str) or len(instructions.strip()) == 0 or len(instructions) > 5000:
        return False, "Invalid instructions"
    
    return True, None

def validate_comment_input(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    comment = data.get('comment')
    if not comment or not isinstance(comment, str) or len(comment.strip()) == 0 or len(comment) > 1000:
        return False, "Invalid comment"
    
    return True, None

def validate_rating_input(data):
    if not isinstance(data, dict):
        return False, "Invalid data format"
    
    rating = data.get('rating')
    if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
        return False, "Invalid rating"
    
    return True, None

# Routes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get recent recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.rowid DESC
            LIMIT 20
        ''')
        
        recipes = cursor.fetchall()
        conn.close()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Overview</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
                .rating { color: #ffa500; }
                a { text-decoration: none; color: #0066cc; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Recipe Overview</h1>
            <div>
                {% for recipe in recipes %}
                <div class="recipe">
                    <h3><a href="/recipes/{{ recipe[0] }}">{{ recipe[1]|e }}</a></h3>
                    {% if recipe[2] %}
                    <span class="rating">Rating: {{ "%.1f"|format(recipe[2]) }}/5</span>
                    {% else %}
                    <span class="rating">No ratings yet</span>
                    {% endif %}
                </div>
                {% endfor %}
                {% if not recipes %}
                <p>No recipes available yet.</p>
                {% endif %}
            </div>
        </body>
        </html>
        '''
        
        response = make_response(render_template_string(html_template, recipes=recipes))
        return response, 200
        
    except Exception:
        return make_response("Server error"), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        # Get JSON data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate input
        valid, error_msg = validate_recipe_input(data)
        if not valid:
            return jsonify({'error': error_msg}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Save to database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (
            recipe_id,
            data['title'].strip(),
            json.dumps([ing.strip() for ing in data['ingredients']]),
            data['instructions'].strip()
        ))
        
        conn.commit()
        conn.close()
        
        # Return the created recipe
        return jsonify({
            'id': recipe_id,
            'title': data['title'].strip(),
            'ingredients': [ing.strip() for ing in data['ingredients']],
            'instructions': data['instructions'].strip(),
            'comments': [],
            'avgRating': None
        }), 201
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return make_response("Recipe not found"), 404
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get recipe
        cursor.execute('SELECT title, ingredients, instructions FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return make_response("Recipe not found"), 404
        
        title, ingredients_json, instructions = recipe
        ingredients = json.loads(ingredients_json)
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY id DESC', (recipe_id,))
        comments = [row[0] for row in cursor.fetchall()]
        
        # Get average rating
        cursor.execute('SELECT AVG(rating) FROM ratings WHERE recipe_id = ?', (recipe_id,))
        avg_rating = cursor.fetchone()[0]
        
        conn.close()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ title|e }}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .section { margin: 20px 0; }
                .ingredient { margin: 5px 0; }
                .comment { margin: 10px 0; padding: 10px; background: #f5f5f5; }
                .rating { color: #ffa500; font-size: 1.2em; }
            </style>
        </head>
        <body>
            <h1>{{ title|e }}</h1>
            
            <div class="section">
                {% if avg_rating %}
                <div class="rating">Average Rating: {{ "%.1f"|format(avg_rating) }}/5</div>
                {% else %}
                <div class="rating">No ratings yet</div>
                {% endif %}
            </div>
            
            <div class="section">
                <h2>Ingredients</h2>
                <ul>
                    {% for ingredient in ingredients %}
                    <li class="ingredient">{{ ingredient|e }}</li>
                    {% endfor %}
                </ul>
            </div>
            
            <div class="section">
                <h2>Instructions</h2>
                <p>{{ instructions|e }}</p>
            </div>
            
            <div class="section">
                <h2>Comments</h2>
                {% for comment in comments %}
                <div class="comment">{{ comment|e }}</div>
                {% endfor %}
                {% if not comments %}
                <p>No comments yet.</p>
                {% endif %}
            </div>
        </body>
        </html>
        '''
        
        response = make_response(render_template_string(
            html_template,
            title=title,
            ingredients=ingredients,
            instructions=instructions,
            comments=comments,
            avg_rating=avg_rating
        ))
        return response, 200
        
    except Exception:
        return make_response("Recipe not found"), 404

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Get JSON data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate input
        valid, error_msg = validate_comment_input(data)
        if not valid:
            return jsonify({'error': error_msg}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add comment
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, data['comment'].strip()))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Get JSON data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate input
        valid, error_msg = validate_rating_input(data)
        if not valid:
            return jsonify({'error': error_msg}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add rating
        cursor.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, data['rating']))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)