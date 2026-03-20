from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
from datetime import datetime
import uuid

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create recipes table
    c.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create comments table
    c.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    # Create ratings table
    c.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# HTML templates
OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Sharing App</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .recipe-list { list-style: none; padding: 0; }
        .recipe-item { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe-item h3 { margin: 0 0 10px 0; }
        .recipe-item a { color: #0066cc; text-decoration: none; }
        .recipe-item a:hover { text-decoration: underline; }
        .rating { color: #ff9900; }
    </style>
</head>
<body>
    <h1>Recipe Sharing App</h1>
    <h2>Recent Recipes</h2>
    <ul class="recipe-list">
        {% for recipe in recipes %}
        <li class="recipe-item">
            <h3><a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a></h3>
            <p class="rating">Average Rating: {{ recipe.avg_rating if recipe.avg_rating else 'No ratings yet' }}</p>
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
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .section { margin: 30px 0; }
        .ingredients { list-style: disc; margin-left: 20px; }
        .comment { padding: 10px; margin: 10px 0; background: #f5f5f5; border-radius: 5px; }
        .rating { color: #ff9900; font-size: 1.2em; }
    </style>
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    
    <div class="section">
        <h2>Average Rating</h2>
        <p class="rating">{{ recipe.avg_rating if recipe.avg_rating else 'No ratings yet' }}</p>
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
            <div class="comment">{{ comment.comment }}</div>
            {% endfor %}
        {% else %}
            <p>No comments yet.</p>
        {% endif %}
    </div>
    
    <p><a href="/recipes">Back to all recipes</a></p>
</body>
</html>
'''

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Get all recipes with their average ratings
        c.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
        ''')
        
        recipes = []
        for row in c.fetchall():
            recipes.append({
                'id': row['id'],
                'title': row['title'],
                'avg_rating': round(row['avg_rating'], 1) if row['avg_rating'] else None
            })
        
        conn.close()
        
        return render_template_string(OVERVIEW_TEMPLATE, recipes=recipes), 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        title = data['title']
        ingredients = data['ingredients']
        instructions = data['instructions']
        
        # Validate types
        if not isinstance(title, str) or not isinstance(ingredients, list) or not isinstance(instructions, str):
            return jsonify({'error': 'Invalid input types'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, title, json.dumps(ingredients), instructions))
        
        conn.commit()
        conn.close()
        
        # Return created recipe
        return jsonify({
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Get recipe
        c.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,))
        recipe_row = c.fetchone()
        
        if not recipe_row:
            conn.close()
            return 'Recipe not found', 404
        
        # Get comments
        c.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipeId,))
        comments = [{'comment': row['comment']} for row in c.fetchall()]
        
        # Get average rating
        c.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipeId,))
        avg_rating_row = c.fetchone()
        avg_rating = round(avg_rating_row['avg_rating'], 1) if avg_rating_row['avg_rating'] else None
        
        conn.close()
        
        recipe = {
            'id': recipe_row['id'],
            'title': recipe_row['title'],
            'ingredients': json.loads(recipe_row['ingredients']),
            'instructions': recipe_row['instructions'],
            'comments': comments,
            'avg_rating': avg_rating
        }
        
        return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe), 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        comment = data['comment']
        
        if not isinstance(comment, str):
            return jsonify({'error': 'Invalid input type'}), 400
        
        # Check if recipe exists
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add comment
        c.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipeId, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        rating = data['rating']
        
        # Validate rating value
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400
        
        # Check if recipe exists
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add rating
        c.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipeId, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)