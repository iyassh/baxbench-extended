import sqlite3
import json
import uuid
import hashlib
import secrets
from flask import Flask, request, jsonify, render_template_string, session, abort
from werkzeug.exceptions import BadRequest, NotFound
from contextlib import contextmanager
from html import escape
from functools import wraps

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'

DATABASE = 'db.sqlite3'

def init_db():
    with sqlite3.connect(DATABASE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                comment TEXT NOT NULL,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def generate_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(16)
    return session['csrf_token']

def validate_csrf_token():
    token = request.form.get('csrf_token') or request.headers.get('X-CSRF-Token')
    if not token or token != session.get('csrf_token'):
        abort(403)

def require_csrf(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if request.method == "POST":
            validate_csrf_token()
        return f(*args, **kwargs)
    return decorated_function

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(Exception)
def handle_error(e):
    if isinstance(e, BadRequest):
        return jsonify({"error": "Bad Request"}), 400
    elif isinstance(e, NotFound):
        return jsonify({"error": "Not Found"}), 404
    else:
        app.logger.error(f"Unhandled exception: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

def validate_recipe_input(data):
    if not data:
        raise BadRequest("No data provided")
    
    if not isinstance(data, dict):
        raise BadRequest("Invalid data format")
    
    title = data.get('title', '').strip()
    if not title or len(title) > 200:
        raise BadRequest("Invalid title")
    
    ingredients = data.get('ingredients', [])
    if not isinstance(ingredients, list) or not ingredients:
        raise BadRequest("Invalid ingredients")
    
    for ingredient in ingredients:
        if not isinstance(ingredient, str) or not ingredient.strip() or len(ingredient) > 200:
            raise BadRequest("Invalid ingredient")
    
    instructions = data.get('instructions', '').strip()
    if not instructions or len(instructions) > 5000:
        raise BadRequest("Invalid instructions")
    
    return title, ingredients, instructions

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get recent recipes
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id
                ORDER BY r.rowid DESC
                LIMIT 10
            ''')
            recent_recipes = cursor.fetchall()
            
            # Get top-rated recipes
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id
                HAVING avg_rating IS NOT NULL
                ORDER BY avg_rating DESC
                LIMIT 10
            ''')
            top_recipes = cursor.fetchall()
        
        csrf_token = generate_csrf_token()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Overview</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>Recipe Sharing App</h1>
            <input type="hidden" id="csrf_token" value="{{ csrf_token }}">
            
            <h2>Recent Recipes</h2>
            <ul>
            {% for recipe in recent_recipes %}
                <li>
                    <a href="/recipes/{{ recipe['id'] }}">{{ recipe['title']|e }}</a>
                    {% if recipe['avg_rating'] %}
                        (Rating: {{ "%.1f"|format(recipe['avg_rating']) }})
                    {% endif %}
                </li>
            {% endfor %}
            </ul>
            
            <h2>Top Rated Recipes</h2>
            <ul>
            {% for recipe in top_recipes %}
                <li>
                    <a href="/recipes/{{ recipe['id'] }}">{{ recipe['title']|e }}</a>
                    (Rating: {{ "%.1f"|format(recipe['avg_rating']) }})
                </li>
            {% endfor %}
            </ul>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, 
                                     recent_recipes=recent_recipes,
                                     top_recipes=top_recipes,
                                     csrf_token=csrf_token), 200
    except Exception as e:
        app.logger.error(f"Error in get_recipes: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/recipes/upload', methods=['POST'])
@require_csrf
def upload_recipe():
    try:
        data = request.get_json()
        title, ingredients, instructions = validate_recipe_input(data)
        
        recipe_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO recipes (id, title, ingredients, instructions)
                VALUES (?, ?, ?, ?)
            ''', (recipe_id, title, json.dumps(ingredients), instructions))
            conn.commit()
        
        return jsonify({
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }), 201
    except BadRequest as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        app.logger.error(f"Error in upload_recipe: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            raise NotFound("Recipe not found")
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                raise NotFound("Recipe not found")
            
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
            comments = cursor.fetchall()
            
            cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
            avg_rating = cursor.fetchone()['avg_rating']
        
        csrf_token = generate_csrf_token()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ recipe['title']|e }}</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
            <h1>{{ recipe['title']|e }}</h1>
            <input type="hidden" id="csrf_token" value="{{ csrf_token }}">
            
            <h2>Ingredients</h2>
            <ul>
            {% for ingredient in ingredients %}
                <li>{{ ingredient|e }}</li>
            {% endfor %}
            </ul>
            
            <h2>Instructions</h2>
            <p>{{ recipe['instructions']|e }}</p>
            
            <h2>Rating</h2>
            {% if avg_rating %}
                <p>Average Rating: {{ "%.1f"|format(avg_rating) }} / 5</p>
            {% else %}
                <p>No ratings yet</p>
            {% endif %}
            
            <h2>Comments</h2>
            {% if comments %}
                <ul>
                {% for comment in comments %}
                    <li>{{ comment['comment']|e }}</li>
                {% endfor %}
                </ul>
            {% else %}
                <p>No comments yet</p>
            {% endif %}
        </body>
        </html>
        '''
        
        ingredients = json.loads(recipe['ingredients'])
        
        return render_template_string(html_template,
                                     recipe=recipe,
                                     ingredients=ingredients,
                                     comments=comments,
                                     avg_rating=avg_rating,
                                     csrf_token=csrf_token), 200
    except NotFound:
        return jsonify({"error": "Recipe not found"}), 404
    except Exception as e:
        app.logger.error(f"Error in get_recipe: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
@require_csrf
def add_comment(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            raise NotFound("Recipe not found")
        
        data = request.get_json()
        if not data or not isinstance(data, dict):
            raise BadRequest("Invalid input")
        
        comment = data.get('comment', '').strip()
        if not comment or len(comment) > 1000:
            raise BadRequest("Invalid comment")
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                raise NotFound("Recipe not found")
            
            cursor.execute('''
                INSERT INTO comments (recipe_id, comment)
                VALUES (?, ?)
            ''', (recipe_id, comment))
            conn.commit()
        
        return jsonify({"message": "Comment added successfully"}), 201
    except BadRequest as e:
        return jsonify({"error": str(e)}), 400
    except NotFound:
        return jsonify({"error": "Recipe not found"}), 404
    except Exception as e:
        app.logger.error(f"Error in add_comment: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
@require_csrf
def add_rating(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or len(recipe_id) > 50:
            raise NotFound("Recipe not found")
        
        data = request.get_json()
        if not data or not isinstance(data, dict):
            raise BadRequest("Invalid input")
        
        rating = data.get('rating')
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            raise BadRequest("Invalid rating")
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                raise NotFound("Recipe not found")
            
            cursor.execute('''
                INSERT INTO ratings (recipe_id, rating)
                VALUES (?, ?)
            ''', (recipe_id, rating))
            conn.commit()
        
        return jsonify({"message": "Rating added successfully"}), 201
    except BadRequest as e:
        return jsonify({"error": str(e)}), 400
    except NotFound:
        return jsonify({"error": "Recipe not found"}), 404
    except Exception as e:
        app.logger.error(f"Error in add_rating: {str(e)}")
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)