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
    
    # Create recipes table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create comments table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    # Create ratings table
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
RECIPE_LIST_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .recipe-list { list-style: none; padding: 0; }
        .recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe-title { font-weight: bold; font-size: 18px; }
        .recipe-rating { color: #666; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent Recipes</h2>
    <ul class="recipe-list">
        {% for recipe in recent_recipes %}
        <li class="recipe-item">
            <div class="recipe-title">
                <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
            </div>
            <div class="recipe-rating">Average Rating: {{ recipe.avg_rating if recipe.avg_rating else 'Not rated yet' }}</div>
        </li>
        {% endfor %}
    </ul>
    <h2>Top Rated Recipes</h2>
    <ul class="recipe-list">
        {% for recipe in top_recipes %}
        <li class="recipe-item">
            <div class="recipe-title">
                <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
            </div>
            <div class="recipe-rating">Average Rating: {{ recipe.avg_rating }}</div>
        </li>
        {% endfor %}
    </ul>
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
        h1 { color: #333; }
        .section { margin: 20px 0; }
        .ingredients { list-style-type: disc; margin-left: 20px; }
        .instructions { line-height: 1.6; }
        .rating { color: #f39c12; font-size: 20px; }
        .comments { margin-top: 30px; }
        .comment { padding: 10px; margin: 10px 0; background: #f5f5f5; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    
    <div class="section">
        <div class="rating">Average Rating: {{ recipe.avg_rating if recipe.avg_rating else 'Not rated yet' }}</div>
    </div>
    
    <div class="section">
        <h2>Ingredients</h2>
        <ul class="ingredients">
            {% for ingredient in recipe.ingredients %}
            <li>{{ ingredient }}</li>
            {% endfor %}
        </ul>
    </div>
    
    <div class="section">
        <h2>Instructions</h2>
        <div class="instructions">{{ recipe.instructions }}</div>
    </div>
    
    <div class="comments">
        <h2>Comments</h2>
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

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def sanitize_input(text):
    """Sanitize input to prevent XSS attacks"""
    if text is None:
        return None
    return html.escape(str(text))

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
        recent_recipes = []
        for row in cursor.fetchall():
            recent_recipes.append({
                'id': row['id'],
                'title': sanitize_input(row['title']),
                'avg_rating': round(row['avg_rating'], 1) if row['avg_rating'] else None
            })
        
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
        top_recipes = []
        for row in cursor.fetchall():
            top_recipes.append({
                'id': row['id'],
                'title': sanitize_input(row['title']),
                'avg_rating': round(row['avg_rating'], 1)
            })
        
        conn.close()
        
        return render_template_string(RECIPE_LIST_TEMPLATE, 
                                     recent_recipes=recent_recipes, 
                                     top_recipes=top_recipes), 200
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate data types
        if not isinstance(data['title'], str) or not data['title'].strip():
            return jsonify({'error': 'Invalid title'}), 400
        
        if not isinstance(data['ingredients'], list) or len(data['ingredients']) == 0:
            return jsonify({'error': 'Invalid ingredients'}), 400
        
        for ingredient in data['ingredients']:
            if not isinstance(ingredient, str) or not ingredient.strip():
                return jsonify({'error': 'Invalid ingredient'}), 400
        
        if not isinstance(data['instructions'], str) or not data['instructions'].strip():
            return jsonify({'error': 'Invalid instructions'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
        
        conn.commit()
        conn.close()
        
        # Return created recipe
        recipe = {
            'id': recipe_id,
            'title': data['title'],
            'ingredients': data['ingredients'],
            'instructions': data['instructions'],
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(recipe), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        # Validate recipe_id format
        if not recipe_id or not isinstance(recipe_id, str):
            return jsonify({'error': 'Invalid recipe ID'}), 404
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get recipe
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe_row = cursor.fetchone()
        
        if not recipe_row:
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
        comments = [{'comment': sanitize_input(row['comment'])} for row in cursor.fetchall()]
        
        # Get average rating
        cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
        rating_row = cursor.fetchone()
        avg_rating = round(rating_row['avg_rating'], 1) if rating_row['avg_rating'] else None
        
        conn.close()
        
        recipe = {
            'id': recipe_row['id'],
            'title': sanitize_input(recipe_row['title']),
            'ingredients': [sanitize_input(ing) for ing in json.loads(recipe_row['ingredients'])],
            'instructions': sanitize_input(recipe_row['instructions']),
            'comments': comments,
            'avg_rating': avg_rating
        }
        
        return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe), 200
        
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        # Validate recipe_id
        if not recipe_id or not isinstance(recipe_id, str):
            return jsonify({'error': 'Invalid recipe ID'}), 404
        
        data = request.get_json()
        
        # Validate comment
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        if not isinstance(data['comment'], str) or not data['comment'].strip():
            return jsonify({'error': 'Invalid comment'}), 400
        
        # Check if recipe exists
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add comment
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, data['comment']))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        # Validate recipe_id
        if not recipe_id or not isinstance(recipe_id, str):
            return jsonify({'error': 'Invalid recipe ID'}), 404
        
        data = request.get_json()
        
        # Validate rating
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        if not isinstance(data['rating'], int) or data['rating'] < 1 or data['rating'] > 5:
            return jsonify({'error': 'Invalid rating. Must be an integer between 1 and 5'}), 400
        
        # Check if recipe exists
        conn = get_db_connection()
        cursor = conn.cursor()
        
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
        
        return jsonify({'message': 'Rating added successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)