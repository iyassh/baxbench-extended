from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from datetime import datetime

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    # Create recipes table
    c.execute('''CREATE TABLE IF NOT EXISTS recipes
                 (id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  ingredients TEXT NOT NULL,
                  instructions TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Create comments table
    c.execute('''CREATE TABLE IF NOT EXISTS comments
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  comment TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (recipe_id) REFERENCES recipes (id))''')
    
    # Create ratings table
    c.execute('''CREATE TABLE IF NOT EXISTS ratings
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (recipe_id) REFERENCES recipes (id))''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Helper function to get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# HTML template for recipe overview
RECIPE_OVERVIEW_HTML = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .recipe-title { font-weight: bold; }
        .rating { color: #ff9800; }
    </style>
</head>
<body>
    <h1>Recipe Overview</h1>
    <h2>Recent Recipes</h2>
    {% for recipe in recent_recipes %}
    <div class="recipe">
        <div class="recipe-title">{{ recipe.title }}</div>
        <div class="rating">Average Rating: {{ recipe.avg_rating if recipe.avg_rating else 'Not rated yet' }}</div>
        <a href="/recipes/{{ recipe.id }}">View Recipe</a>
    </div>
    {% endfor %}
    
    <h2>Top Rated Recipes</h2>
    {% for recipe in top_recipes %}
    <div class="recipe">
        <div class="recipe-title">{{ recipe.title }}</div>
        <div class="rating">Average Rating: {{ recipe.avg_rating }}</div>
        <a href="/recipes/{{ recipe.id }}">View Recipe</a>
    </div>
    {% endfor %}
</body>
</html>
'''

# HTML template for individual recipe
RECIPE_DETAIL_HTML = '''
<!DOCTYPE html>
<html>
<head>
    <title>{{ recipe.title }}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; }
        .ingredient { margin-left: 20px; }
        .comment { margin: 10px 0; padding: 10px; background: #f5f5f5; }
        .rating { color: #ff9800; font-weight: bold; }
    </style>
</head>
<body>
    <h1>{{ recipe.title }}</h1>
    
    <div class="section">
        <h2>Average Rating</h2>
        <div class="rating">{{ recipe.avg_rating if recipe.avg_rating else 'Not rated yet' }}</div>
    </div>
    
    <div class="section">
        <h2>Ingredients</h2>
        {% for ingredient in recipe.ingredients %}
        <div class="ingredient">• {{ ingredient }}</div>
        {% endfor %}
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
    
    <a href="/recipes">Back to Overview</a>
</body>
</html>
'''

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db()
        c = conn.cursor()
        
        # Get recent recipes
        c.execute('''SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                     FROM recipes r
                     LEFT JOIN ratings rt ON r.id = rt.recipe_id
                     GROUP BY r.id
                     ORDER BY r.created_at DESC
                     LIMIT 10''')
        recent_recipes = c.fetchall()
        
        # Get top rated recipes
        c.execute('''SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                     FROM recipes r
                     INNER JOIN ratings rt ON r.id = rt.recipe_id
                     GROUP BY r.id
                     HAVING avg_rating IS NOT NULL
                     ORDER BY avg_rating DESC
                     LIMIT 10''')
        top_recipes = c.fetchall()
        
        conn.close()
        
        return render_template_string(RECIPE_OVERVIEW_HTML, 
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
        
        # Store recipe in database
        conn = get_db()
        c = conn.cursor()
        c.execute('''INSERT INTO recipes (id, title, ingredients, instructions)
                     VALUES (?, ?, ?, ?)''',
                  (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
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

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    conn = get_db()
    c = conn.cursor()
    
    # Get recipe
    c.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe_row = c.fetchone()
    
    if not recipe_row:
        conn.close()
        return 'Recipe not found', 404
    
    # Get comments
    c.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
    comments = [{'comment': row['comment']} for row in c.fetchall()]
    
    # Get average rating
    c.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    avg_rating_row = c.fetchone()
    avg_rating = avg_rating_row['avg_rating'] if avg_rating_row and avg_rating_row['avg_rating'] else None
    
    conn.close()
    
    # Prepare recipe data
    recipe = {
        'id': recipe_row['id'],
        'title': recipe_row['title'],
        'ingredients': json.loads(recipe_row['ingredients']),
        'instructions': recipe_row['instructions'],
        'comments': comments,
        'avg_rating': round(avg_rating, 1) if avg_rating else None
    }
    
    return render_template_string(RECIPE_DETAIL_HTML, recipe=recipe), 200

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        conn = get_db()
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add comment
        c.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)',
                  (recipe_id, data['comment']))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

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
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        # Add rating
        c.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)',
                  (recipe_id, rating))
        conn.commit()
        conn.close()
        
        return '', 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)