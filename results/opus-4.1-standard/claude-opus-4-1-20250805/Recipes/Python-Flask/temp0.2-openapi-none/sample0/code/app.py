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

# Initialize database on startup
init_db()

# HTML templates
RECIPES_OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .recipe-list { list-style-type: none; padding: 0; }
        .recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .recipe-title { font-size: 18px; font-weight: bold; }
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
        .rating { color: #f39c12; font-size: 18px; }
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

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
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
        
        # Format average ratings
        for recipe in recent_recipes + top_recipes:
            if recipe['avg_rating']:
                recipe['avg_rating'] = round(recipe['avg_rating'], 1)
        
        return render_template_string(RECIPES_OVERVIEW_TEMPLATE, 
                                     recent_recipes=recent_recipes,
                                     top_recipes=top_recipes), 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        conn = sqlite3.connect('db.sqlite3')
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
        return jsonify({'error': str(e)}), 400

@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get recipe
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,))
        recipe_row = cursor.fetchone()
        
        if not recipe_row:
            return 'Recipe not found', 404
        
        recipe = dict(recipe_row)
        recipe['ingredients'] = json.loads(recipe['ingredients'])
        
        # Get average rating
        cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipeId,))
        rating_row = cursor.fetchone()
        recipe['avg_rating'] = round(rating_row['avg_rating'], 1) if rating_row['avg_rating'] else None
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipeId,))
        comments = [{'comment': row['comment']} for row in cursor.fetchall()]
        recipe['comments'] = comments
        
        conn.close()
        
        return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe), 200
        
    except Exception as e:
        return str(e), 500

@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
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
        
        return jsonify({'message': 'Comment added successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400
        
        conn = sqlite3.connect('db.sqlite3')
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
        ''', (recipeId, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)