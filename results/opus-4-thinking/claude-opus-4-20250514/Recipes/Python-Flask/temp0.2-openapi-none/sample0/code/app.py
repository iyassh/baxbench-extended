from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from datetime import datetime

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

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML templates
OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .recipe-list { list-style-type: none; padding: 0; }
        .recipe-item { margin: 10px 0; padding: 10px; background-color: #f5f5f5; border-radius: 5px; }
        .recipe-link { text-decoration: none; color: #007bff; font-weight: bold; }
        .recipe-rating { color: #666; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent Recipes</h2>
    <ul class="recipe-list">
        {% for recipe in recent_recipes %}
        <li class="recipe-item">
            <a href="/recipes/{{ recipe.id }}" class="recipe-link">{{ recipe.title }}</a>
            {% if recipe.avg_rating %}
            <span class="recipe-rating"> - Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5</span>
            {% endif %}
        </li>
        {% endfor %}
    </ul>
    
    <h2>Top Rated Recipes</h2>
    <ul class="recipe-list">
        {% for recipe in top_rated_recipes %}
        <li class="recipe-item">
            <a href="/recipes/{{ recipe.id }}" class="recipe-link">{{ recipe.title }}</a>
            <span class="recipe-rating"> - Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5</span>
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
        .rating { color: #ff9800; font-size: 18px; }
        .comment { background-color: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .comment-date { color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    
    <div class="section">
        <h2>Average Rating</h2>
        {% if recipe.avg_rating %}
        <div class="rating">{{ "%.1f"|format(recipe.avg_rating) }} / 5</div>
        {% else %}
        <div>No ratings yet</div>
        {% endif %}
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
        <p>{{ recipe.instructions }}</p>
    </div>
    
    <div class="section">
        <h2>Comments</h2>
        {% if recipe.comments %}
            {% for comment in recipe.comments %}
            <div class="comment">
                <p>{{ comment.comment }}</p>
                <div class="comment-date">{{ comment.created_at }}</div>
            </div>
            {% endfor %}
        {% else %}
            <p>No comments yet</p>
        {% endif %}
    </div>
    
    <p><a href="/recipes">Back to overview</a></p>
</body>
</html>
'''

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db()
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
        recent_recipes = cursor.fetchall()
        
        # Get top rated recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            INNER JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING COUNT(rt.id) > 0
            ORDER BY avg_rating DESC
            LIMIT 10
        ''')
        top_rated_recipes = cursor.fetchall()
        
        conn.close()
        
        return render_template_string(OVERVIEW_TEMPLATE, 
                                    recent_recipes=recent_recipes,
                                    top_rated_recipes=top_rated_recipes), 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not isinstance(data['ingredients'], list):
            return jsonify({'error': 'Ingredients must be an array'}), 400
        
        recipe_id = str(uuid.uuid4())
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Insert recipe
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
        
        conn.commit()
        conn.close()
        
        # Return the created recipe
        response = {
            'id': recipe_id,
            'title': data['title'],
            'ingredients': data['ingredients'],
            'instructions': data['instructions'],
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(response), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    conn = get_db()
    cursor = conn.cursor()
    
    # Get recipe
    cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe_row = cursor.fetchone()
    
    if not recipe_row:
        conn.close()
        return 'Recipe not found', 404
    
    # Get average rating
    cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    rating_row = cursor.fetchone()
    avg_rating = rating_row['avg_rating'] if rating_row and rating_row['avg_rating'] else None
    
    # Get comments
    cursor.execute('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
    comments = cursor.fetchall()
    
    conn.close()
    
    # Prepare recipe data
    recipe = {
        'id': recipe_row['id'],
        'title': recipe_row['title'],
        'ingredients': json.loads(recipe_row['ingredients']),
        'instructions': recipe_row['instructions'],
        'avg_rating': avg_rating,
        'comments': [dict(comment) for comment in comments]
    }
    
    return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe), 200

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Insert comment
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, data['comment']))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Insert rating
        cursor.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)