from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from contextlib import contextmanager

app = Flask(__name__)

DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
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

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT id, title FROM recipes ORDER BY rowid DESC LIMIT 10')
            recent_recipes = cursor.fetchall()
            
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                INNER JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id
                ORDER BY avg_rating DESC
                LIMIT 10
            ''')
            top_recipes = cursor.fetchall()
            
            html = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Overview</title>
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
                    <li><a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a></li>
                {% endfor %}
                </ul>
            </body>
            </html>
            '''
            
            return render_template_string(html, recent_recipes=recent_recipes, top_recipes=top_recipes), 200
    except Exception:
        return 'Server error', 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    
    if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    title = data.get('title')
    ingredients = data.get('ingredients')
    instructions = data.get('instructions')
    
    if not isinstance(title, str) or not title.strip():
        return jsonify({'error': 'Invalid input'}), 400
    
    if not isinstance(ingredients, list) or len(ingredients) == 0:
        return jsonify({'error': 'Invalid input'}), 400
    
    for ingredient in ingredients:
        if not isinstance(ingredient, str):
            return jsonify({'error': 'Invalid input'}), 400
    
    if not isinstance(instructions, str) or not instructions.strip():
        return jsonify({'error': 'Invalid input'}), 400
    
    recipe_id = str(uuid.uuid4())
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                'INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
                (recipe_id, title, json.dumps(ingredients), instructions)
            )
            conn.commit()
        
        return jsonify({
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }), 201
    except Exception:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return 'Recipe not found', 404
            
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
            comments = cursor.fetchall()
            
            cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
            avg_rating_row = cursor.fetchone()
            avg_rating = avg_rating_row['avg_rating'] if avg_rating_row['avg_rating'] else None
            
            html = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>{{ title }}</title>
            </head>
            <body>
                <h1>{{ title }}</h1>
                
                <h2>Ingredients</h2>
                <ul>
                {% for ingredient in ingredients %}
                    <li>{{ ingredient }}</li>
                {% endfor %}
                </ul>
                
                <h2>Instructions</h2>
                <p>{{ instructions }}</p>
                
                <h2>Average Rating</h2>
                <p>{% if avg_rating %}{{ "%.1f"|format(avg_rating) }}{% else %}No ratings yet{% endif %}</p>
                
                <h2>Comments</h2>
                {% if comments %}
                <ul>
                {% for comment in comments %}
                    <li>{{ comment.comment }}</li>
                {% endfor %}
                </ul>
                {% else %}
                <p>No comments yet</p>
                {% endif %}
            </body>
            </html>
            '''
            
            return render_template_string(
                html,
                title=recipe['title'],
                ingredients=json.loads(recipe['ingredients']),
                instructions=recipe['instructions'],
                avg_rating=avg_rating,
                comments=comments
            ), 200
    except Exception:
        return 'Server error', 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    data = request.get_json()
    
    if not data or 'comment' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    comment = data.get('comment')
    
    if not isinstance(comment, str) or not comment.strip():
        return jsonify({'error': 'Invalid input'}), 400
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Recipe not found'}), 404
            
            cursor.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipe_id, comment))
            conn.commit()
        
        return '', 201
    except Exception:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    data = request.get_json()
    
    if not data or 'rating' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    
    rating = data.get('rating')
    
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        return jsonify({'error': 'Invalid input'}), 400
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Recipe not found'}), 404
            
            cursor.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipe_id, rating))
            conn.commit()
        
        return '', 201
    except Exception:
        return jsonify({'error': 'Server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)