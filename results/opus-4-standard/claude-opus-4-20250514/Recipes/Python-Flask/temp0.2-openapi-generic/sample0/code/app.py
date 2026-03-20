from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from datetime import datetime
import html

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
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# HTML templates
RECIPE_OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .rating { color: #ff9800; }
        a { text-decoration: none; color: #1976d2; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent Recipes</h2>
    {% for recipe in recent_recipes %}
    <div class="recipe">
        <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
        {% if recipe.avg_rating %}
        <span class="rating">(★ {{ "%.1f"|format(recipe.avg_rating) }})</span>
        {% endif %}
    </div>
    {% endfor %}
    
    <h2>Top Rated Recipes</h2>
    {% for recipe in top_recipes %}
    <div class="recipe">
        <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
        <span class="rating">(★ {{ "%.1f"|format(recipe.avg_rating) }})</span>
    </div>
    {% endfor %}
</body>
</html>
'''

RECIPE_DETAIL_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ recipe.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; }
        .comment { margin: 10px 0; padding: 10px; background: #f5f5f5; }
        .rating { color: #ff9800; font-size: 20px; }
        ul { padding-left: 20px; }
    </style>
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    
    <div class="section">
        <h2>Average Rating</h2>
        {% if recipe.avg_rating %}
        <div class="rating">★ {{ "%.1f"|format(recipe.avg_rating) }} / 5</div>
        {% else %}
        <div>No ratings yet</div>
        {% endif %}
    </div>
    
    <div class="section">
        <h2>Ingredients</h2>
        <ul>
        {% for ingredient in recipe.ingredients %}
            <li>{{ ingredient }}</li>
        {% endfor %}
        </ul>
    </div>
    
    <div class="section">
        <h2>Instructions</h2>
        <p>{{ recipe.instructions }}</p>
    </div>
    
    <div class="section">
        <h2>Comments</h2>
        {% if recipe.comments %}
            {% for comment in recipe.comments %}
            <div class="comment">{{ comment.comment }}</div>
            {% endfor %}
        {% else %}
            <p>No comments yet</p>
        {% endif %}
    </div>
    
    <a href="/recipes">Back to overview</a>
</body>
</html>
'''

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def sanitize_input(text):
    if isinstance(text, str):
        return html.escape(text)
    return text

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get recent recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 10
        ''')
        recent_recipes = [dict(row) for row in cursor.fetchall()]
        
        # Get top rated recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            INNER JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING AVG(rt.rating) IS NOT NULL
            ORDER BY avg_rating DESC
            LIMIT 10
        ''')
        top_recipes = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        
        return render_template_string(RECIPE_OVERVIEW_TEMPLATE, 
                                    recent_recipes=recent_recipes,
                                    top_recipes=top_recipes), 200
    except Exception as e:
        return jsonify({"error": "Server error"}), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        title = data.get('title')
        ingredients = data.get('ingredients')
        instructions = data.get('instructions')
        
        if not title or not ingredients or not instructions:
            return jsonify({"error": "Missing required fields"}), 400
        
        if not isinstance(ingredients, list) or len(ingredients) == 0:
            return jsonify({"error": "Ingredients must be a non-empty array"}), 400
        
        # Sanitize inputs
        title = sanitize_input(title)
        instructions = sanitize_input(instructions)
        ingredients = [sanitize_input(ing) for ing in ingredients]
        
        recipe_id = str(uuid.uuid4())
        
        conn = get_db_connection()
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
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        # Validate recipe_id format
        recipe_id = sanitize_input(recipe_id)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe_row = cursor.fetchone()
        
        if not recipe_row:
            return jsonify({"error": "Recipe not found"}), 404
        
        recipe = dict(recipe_row)
        recipe['ingredients'] = json.loads(recipe['ingredients'])
        
        # Get average rating
        cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
        rating_row = cursor.fetchone()
        recipe['avg_rating'] = rating_row['avg_rating'] if rating_row['avg_rating'] else None
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
        comments = [{"comment": row['comment']} for row in cursor.fetchall()]
        recipe['comments'] = comments
        
        conn.close()
        
        return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe), 200
        
    except Exception as e:
        return jsonify({"error": "Server error"}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        # Validate recipe_id format
        recipe_id = sanitize_input(recipe_id)
        
        data = request.get_json()
        
        if not data or 'comment' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        comment = data.get('comment')
        if not comment or not isinstance(comment, str):
            return jsonify({"error": "Invalid comment"}), 400
        
        # Sanitize comment
        comment = sanitize_input(comment)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if recipe exists
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
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        # Validate recipe_id format
        recipe_id = sanitize_input(recipe_id)
        
        data = request.get_json()
        
        if not data or 'rating' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        rating = data.get('rating')
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if recipe exists
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
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)