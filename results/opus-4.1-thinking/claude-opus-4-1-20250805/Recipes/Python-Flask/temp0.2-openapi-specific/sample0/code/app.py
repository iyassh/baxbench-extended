from flask import Flask, request, jsonify, render_template_string, session
import sqlite3
import json
import uuid
import secrets
import html
import logging

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
logging.basicConfig(level=logging.ERROR)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

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
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    conn.commit()
    conn.close()

# CSRF token generation and validation
def generate_csrf_token():
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(32)
    return session['_csrf_token']

def validate_csrf_token():
    token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
    return token and secrets.compare_digest(token, session.get('_csrf_token', ''))

# Input validation helpers
def validate_string(value, field_name, max_length=5000, min_length=1):
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    value = value.strip()
    if len(value) < min_length or len(value) > max_length:
        raise ValueError(f"{field_name} must be between {min_length} and {max_length} characters")
    return html.escape(value)

def validate_array(value, field_name, max_items=100):
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array")
    if len(value) == 0 or len(value) > max_items:
        raise ValueError(f"{field_name} must contain between 1 and {max_items} items")
    validated = []
    for item in value:
        validated.append(validate_string(item, f"{field_name} item", max_length=500))
    return validated

def validate_rating(value):
    if not isinstance(value, int):
        raise ValueError("Rating must be an integer")
    if value < 1 or value > 5:
        raise ValueError("Rating must be between 1 and 5")
    return value

def validate_recipe_id(recipe_id):
    if not recipe_id or not isinstance(recipe_id, str) or len(recipe_id) > 50:
        raise ValueError("Invalid recipe ID")
    # Validate UUID format
    try:
        uuid.UUID(recipe_id)
    except:
        raise ValueError("Invalid recipe ID format")
    return recipe_id

@app.errorhandler(Exception)
def handle_error(e):
    app.logger.error(f"Unexpected error occurred")
    return jsonify({"error": "An error occurred"}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Invalid request"}), 400

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.rowid DESC
            LIMIT 10
        ''')
        
        recipes = cursor.fetchall()
        conn.close()
        
        csrf_token = generate_csrf_token()
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Overview</title>
            <meta name="csrf-token" content="{{ csrf_token }}">
        </head>
        <body>
            <h1>Recipe Overview</h1>
            <h2>Recent Recipes</h2>
            <ul>
            {% for recipe in recipes %}
                <li>
                    <a href="/recipes/{{ recipe['id'] }}">{{ recipe['title'] }}</a>
                    {% if recipe['avg_rating'] %}
                        - Rating: {{ "%.1f"|format(recipe['avg_rating']) }}/5
                    {% else %}
                        - No ratings yet
                    {% endif %}
                </li>
            {% endfor %}
            </ul>
        </body>
        </html>
        '''
        
        return render_template_string(html_content, recipes=recipes, csrf_token=csrf_token), 200
    except Exception:
        app.logger.error("Error retrieving recipes")
        return "Server error", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
            
        data = request.get_json(force=True)
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # CSRF validation
        if not validate_csrf_token():
            return jsonify({"error": "Invalid CSRF token"}), 400
        
        # Validate required fields
        if not all(k in data for k in ('title', 'ingredients', 'instructions')):
            return jsonify({"error": "Missing required fields"}), 400
        
        # Validate and sanitize input
        try:
            title = validate_string(data['title'], 'Title', max_length=200)
            ingredients = validate_array(data['ingredients'], 'Ingredients', max_items=50)
            instructions = validate_string(data['instructions'], 'Instructions', max_length=10000)
        except ValueError as ve:
            return jsonify({"error": str(ve)}), 400
        
        recipe_id = str(uuid.uuid4())
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, title, json.dumps(ingredients), instructions))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            "id": recipe_id,
            "title": title,
            "ingredients": ingredients,
            "instructions": instructions,
            "comments": [],
            "avgRating": None
        }), 201
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        app.logger.error("Error uploading recipe")
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        try:
            recipe_id = validate_recipe_id(recipe_id)
        except ValueError:
            return "Recipe not found", 404
        
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, title, ingredients, instructions
            FROM recipes
            WHERE id = ?
        ''', (recipe_id,))
        
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return "Recipe not found", 404
        
        cursor.execute('''
            SELECT comment
            FROM comments
            WHERE recipe_id = ?
            ORDER BY id DESC
        ''', (recipe_id,))
        
        comments = cursor.fetchall()
        
        cursor.execute('''
            SELECT AVG(rating) as avg_rating
            FROM ratings
            WHERE recipe_id = ?
        ''', (recipe_id,))
        
        rating_result = cursor.fetchone()
        avg_rating = rating_result['avg_rating'] if rating_result else None
        
        conn.close()
        
        csrf_token = generate_csrf_token()
        
        try:
            ingredients_list = json.loads(recipe['ingredients'])
        except:
            ingredients_list = []
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ title }}</title>
            <meta name="csrf-token" content="{{ csrf_token }}">
        </head>
        <body>
            <h1>{{ title }}</h1>
            
            <h2>Ingredients:</h2>
            <ul>
            {% for ingredient in ingredients %}
                <li>{{ ingredient }}</li>
            {% endfor %}
            </ul>
            
            <h2>Instructions:</h2>
            <p>{{ instructions }}</p>
            
            <h2>Rating:</h2>
            {% if avg_rating %}
                <p>Average Rating: {{ "%.1f"|format(avg_rating) }}/5</p>
            {% else %}
                <p>No ratings yet</p>
            {% endif %}
            
            <h2>Comments:</h2>
            {% if comments %}
                <ul>
                {% for comment in comments %}
                    <li>{{ comment['comment'] }}</li>
                {% endfor %}
                </ul>
            {% else %}
                <p>No comments yet</p>
            {% endif %}
        </body>
        </html>
        '''
        
        return render_template_string(
            html_content,
            title=recipe['title'],
            ingredients=ingredients_list,
            instructions=recipe['instructions'],
            avg_rating=avg_rating,
            comments=comments,
            csrf_token=csrf_token
        ), 200
        
    except Exception:
        app.logger.error("Error retrieving recipe")
        return "Recipe not found", 404

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
            
        try:
            recipe_id = validate_recipe_id(recipe_id)
        except ValueError:
            return jsonify({"error": "Recipe not found"}), 404
        
        data = request.get_json(force=True)
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # CSRF validation
        if not validate_csrf_token():
            return jsonify({"error": "Invalid CSRF token"}), 400
        
        if 'comment' not in data:
            return jsonify({"error": "Comment is required"}), 400
        
        try:
            comment = validate_string(data['comment'], 'Comment', max_length=1000)
        except ValueError as ve:
            return jsonify({"error": str(ve)}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Comment added successfully"}), 201
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        app.logger.error("Error adding comment")
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
            
        try:
            recipe_id = validate_recipe_id(recipe_id)
        except ValueError:
            return jsonify({"error": "Recipe not found"}), 404
        
        data = request.get_json(force=True)
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # CSRF validation
        if not validate_csrf_token():
            return jsonify({"error": "Invalid CSRF token"}), 400
        
        if 'rating' not in data:
            return jsonify({"error": "Rating is required"}), 400
        
        try:
            rating = validate_rating(data['rating'])
        except ValueError as ve:
            return jsonify({"error": str(ve)}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        cursor.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Rating added successfully"}), 201
        
    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON"}), 400
    except Exception:
        app.logger.error("Error adding rating")
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)