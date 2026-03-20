from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from contextlib import contextmanager

app = Flask(__name__)

# Database setup
def init_db():
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    # Create ratings table
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

@contextmanager
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

# HTML templates
RECIPE_OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .recipe-item { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .recipe-rating { color: #666; }
        a { text-decoration: none; color: #007bff; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Recipe Sharing App</h1>
    <h2>Recent Recipes</h2>
    {% if recipes %}
        {% for recipe in recipes %}
        <div class="recipe-item">
            <div class="recipe-title">
                <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
            </div>
            <div class="recipe-rating">
                {% if recipe.avg_rating %}
                    Average Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5
                {% else %}
                    No ratings yet
                {% endif %}
            </div>
        </div>
        {% endfor %}
    {% else %}
        <p>No recipes available yet.</p>
    {% endif %}
</body>
</html>
'''

RECIPE_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ recipe.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .recipe-header { margin-bottom: 30px; }
        .recipe-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .recipe-rating { color: #666; margin-bottom: 20px; }
        .section { margin: 20px 0; }
        .section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .ingredients { list-style-type: disc; margin-left: 20px; }
        .instructions { line-height: 1.6; }
        .comment { margin: 10px 0; padding: 10px; background-color: #f9f9f9; border-radius: 5px; }
        .back-link { margin-bottom: 20px; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="back-link">
        <a href="/recipes">&larr; Back to Recipes</a>
    </div>
    
    <div class="recipe-header">
        <div class="recipe-title">{{ recipe.title }}</div>
        <div class="recipe-rating">
            {% if recipe.avg_rating %}
                Average Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5 ({{ recipe.rating_count }} ratings)
            {% else %}
                No ratings yet
            {% endif %}
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">Ingredients:</div>
        <ul class="ingredients">
            {% for ingredient in recipe.ingredients %}
            <li>{{ ingredient }}</li>
            {% endfor %}
        </ul>
    </div>
    
    <div class="section">
        <div class="section-title">Instructions:</div>
        <div class="instructions">{{ recipe.instructions }}</div>
    </div>
    
    <div class="section">
        <div class="section-title">Comments:</div>
        {% if recipe.comments %}
            {% for comment in recipe.comments %}
            <div class="comment">{{ comment.comment }}</div>
            {% endfor %}
        {% else %}
            <p>No comments yet.</p>
        {% endif %}
    </div>
</body>
</html>
'''

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get recipes with average ratings
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id, r.title
                ORDER BY r.rowid DESC
                LIMIT 20
            ''')
            
            recipes = []
            for row in cursor.fetchall():
                recipes.append({
                    'id': row['id'],
                    'title': row['title'],
                    'avg_rating': row['avg_rating']
                })
            
            return render_template_string(RECIPE_OVERVIEW_TEMPLATE, recipes=recipes)
    except Exception as e:
        return "Server error", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        # Validate required fields
        if not all(key in data for key in ['title', 'ingredients', 'instructions']):
            return jsonify({"error": "Missing required fields"}), 400
        
        if not data['title'] or not data['ingredients'] or not data['instructions']:
            return jsonify({"error": "Fields cannot be empty"}), 400
        
        if not isinstance(data['ingredients'], list):
            return jsonify({"error": "Ingredients must be a list"}), 400
        
        recipe_id = str(uuid.uuid4())
        ingredients_json = json.dumps(data['ingredients'])
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO recipes (id, title, ingredients, instructions)
                VALUES (?, ?, ?, ?)
            ''', (recipe_id, data['title'], ingredients_json, data['instructions']))
            conn.commit()
        
        return jsonify({
            "id": recipe_id,
            "title": data['title'],
            "ingredients": data['ingredients'],
            "instructions": data['instructions'],
            "comments": [],
            "avgRating": None
        }), 201
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Get recipe details
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe_row = cursor.fetchone()
            
            if not recipe_row:
                return "Recipe not found", 404
            
            # Get comments
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
            comments = [{'comment': row['comment']} for row in cursor.fetchall()]
            
            # Get average rating and count
            cursor.execute('''
                SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count 
                FROM ratings WHERE recipe_id = ?
            ''', (recipe_id,))
            rating_row = cursor.fetchone()
            
            recipe = {
                'id': recipe_row['id'],
                'title': recipe_row['title'],
                'ingredients': json.loads(recipe_row['ingredients']),
                'instructions': recipe_row['instructions'],
                'comments': comments,
                'avg_rating': rating_row['avg_rating'],
                'rating_count': rating_row['rating_count'] if rating_row['avg_rating'] else 0
            }
            
            return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe)
            
    except Exception as e:
        return "Server error", 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        
        if not data or 'comment' not in data:
            return jsonify({"error": "Missing comment field"}), 400
        
        if not data['comment'].strip():
            return jsonify({"error": "Comment cannot be empty"}), 400
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if recipe exists
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Recipe not found"}), 404
            
            # Add comment
            cursor.execute('''
                INSERT INTO comments (recipe_id, comment)
                VALUES (?, ?)
            ''', (recipe_id, data['comment']))
            conn.commit()
        
        return jsonify({"message": "Comment added successfully"}), 201
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        data = request.get_json()
        
        if not data or 'rating' not in data:
            return jsonify({"error": "Missing rating field"}), 400
        
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if recipe exists
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Recipe not found"}), 404
            
            # Add rating
            cursor.execute('''
                INSERT INTO ratings (recipe_id, rating)
                VALUES (?, ?)
            ''', (recipe_id, rating))
            conn.commit()
        
        return jsonify({"message": "Rating added successfully"}), 201
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)