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

# Database connection helper
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML templates - Jinja2 automatically escapes variables
RECIPES_OVERVIEW_TEMPLATE = '''
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
        <li><a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a> (Rating: {{ "%.1f"|format(recipe.avg_rating) }})</li>
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
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    <h2>Ingredients</h2>
    <ul>
    {% for ingredient in ingredients %}
        <li>{{ ingredient }}</li>
    {% endfor %}
    </ul>
    <h2>Instructions</h2>
    <p>{{ recipe.instructions }}</p>
    <h2>Average Rating</h2>
    <p>{{ "%.1f"|format(avg_rating) if avg_rating else "No ratings yet" }}</p>
    <h2>Comments</h2>
    <ul>
    {% for comment in comments %}
        <li>{{ comment.comment }}</li>
    {% endfor %}
    </ul>
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
            SELECT id, title FROM recipes 
            ORDER BY created_at DESC 
            LIMIT 10
        ''')
        recent_recipes = cursor.fetchall()
        
        # Get top rated recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY avg_rating DESC
            LIMIT 10
        ''')
        top_recipes = cursor.fetchall()
        
        conn.close()
        
        return render_template_string(
            RECIPES_OVERVIEW_TEMPLATE,
            recent_recipes=recent_recipes,
            top_recipes=top_recipes
        ), 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate data types
        if not isinstance(data['title'], str) or not isinstance(data['instructions'], str):
            return jsonify({'error': 'Invalid data types'}), 400
        
        if not isinstance(data['ingredients'], list) or not all(isinstance(i, str) for i in data['ingredients']):
            return jsonify({'error': 'Ingredients must be an array of strings'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
        conn.commit()
        
        # Get average rating (will be null for new recipe)
        cursor.execute('''
            SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?
        ''', (recipe_id,))
        avg_rating_row = cursor.fetchone()
        avg_rating = avg_rating_row['avg_rating'] if avg_rating_row else None
        
        conn.close()
        
        # Return the created recipe
        response = {
            'id': recipe_id,
            'title': data['title'],
            'ingredients': data['ingredients'],
            'instructions': data['instructions'],
            'comments': [],
            'avgRating': avg_rating
        }
        
        return jsonify(response), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    conn = get_db()
    cursor = conn.cursor()
    
    # Get recipe
    cursor.execute('''
        SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?
    ''', (recipeId,))
    recipe = cursor.fetchone()
    
    if not recipe:
        conn.close()
        return 'Recipe not found', 404
    
    # Parse ingredients
    ingredients = json.loads(recipe['ingredients'])
    
    # Get average rating
    cursor.execute('''
        SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?
    ''', (recipeId,))
    avg_rating_row = cursor.fetchone()
    avg_rating = avg_rating_row['avg_rating'] if avg_rating_row else None
    
    # Get comments
    cursor.execute('''
        SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC
    ''', (recipeId,))
    comments = cursor.fetchall()
    
    conn.close()
    
    return render_template_string(
        RECIPE_DETAIL_TEMPLATE,
        recipe=recipe,
        ingredients=ingredients,
        avg_rating=avg_rating,
        comments=comments
    ), 200

@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        if not isinstance(data['comment'], str):
            return jsonify({'error': 'Comment must be a string'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add comment
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipeId, data['comment']))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        if not isinstance(data['rating'], int) or data['rating'] < 1 or data['rating'] > 5:
            return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add rating
        cursor.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipeId, data['rating']))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)