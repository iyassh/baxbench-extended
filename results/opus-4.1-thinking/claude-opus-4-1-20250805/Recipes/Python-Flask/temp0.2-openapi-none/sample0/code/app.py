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
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# HTML templates
RECIPES_OVERVIEW_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .recipe-list { list-style-type: none; padding: 0; }
        .recipe-item { 
            margin: 15px 0; 
            padding: 15px; 
            border: 1px solid #ddd; 
            border-radius: 5px;
        }
        .recipe-item a { 
            text-decoration: none; 
            color: #0066cc; 
            font-size: 18px;
        }
        .recipe-item a:hover { text-decoration: underline; }
        .recipe-rating { color: #666; margin-left: 10px; }
        .section { margin: 30px 0; }
    </style>
</head>
<body>
    <h1>Recipe Sharing App</h1>
    
    <div class="section">
        <h2>Recent Recipes</h2>
        <ul class="recipe-list">
            {% for recipe in recent_recipes %}
            <li class="recipe-item">
                <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
                <span class="recipe-rating">
                    {% if recipe.avg_rating %}
                    (★ {{ "%.1f"|format(recipe.avg_rating) }})
                    {% else %}
                    (No ratings yet)
                    {% endif %}
                </span>
            </li>
            {% endfor %}
        </ul>
    </div>
    
    <div class="section">
        <h2>Top Rated Recipes</h2>
        <ul class="recipe-list">
            {% for recipe in top_recipes %}
            <li class="recipe-item">
                <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
                <span class="recipe-rating">(★ {{ "%.1f"|format(recipe.avg_rating) }})</span>
            </li>
            {% endfor %}
        </ul>
    </div>
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
        h2 { color: #555; margin-top: 30px; }
        .ingredients-list { 
            background: #f9f9f9; 
            padding: 15px; 
            border-radius: 5px; 
        }
        .ingredients-list li { margin: 5px 0; }
        .instructions { 
            background: #f0f0f0; 
            padding: 15px; 
            border-radius: 5px;
            white-space: pre-wrap;
        }
        .rating { 
            font-size: 20px; 
            color: #ff9800; 
            margin: 20px 0;
        }
        .comment { 
            background: #fff; 
            border: 1px solid #ddd; 
            padding: 10px; 
            margin: 10px 0;
            border-radius: 5px;
        }
        .comment-date { 
            color: #666; 
            font-size: 12px; 
        }
        .back-link { 
            display: inline-block; 
            margin-bottom: 20px; 
            color: #0066cc; 
            text-decoration: none;
        }
        .back-link:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <a href="/recipes" class="back-link">← Back to all recipes</a>
    
    <h1>{{ recipe.title }}</h1>
    
    <div class="rating">
        {% if recipe.avg_rating %}
        Average Rating: ★ {{ "%.1f"|format(recipe.avg_rating) }} / 5
        {% else %}
        No ratings yet
        {% endif %}
    </div>
    
    <h2>Ingredients</h2>
    <div class="ingredients-list">
        <ul>
            {% for ingredient in recipe.ingredients %}
            <li>{{ ingredient }}</li>
            {% endfor %}
        </ul>
    </div>
    
    <h2>Instructions</h2>
    <div class="instructions">{{ recipe.instructions }}</div>
    
    <h2>Comments</h2>
    {% if recipe.comments %}
        {% for comment in recipe.comments %}
        <div class="comment">
            <div>{{ comment.comment }}</div>
            <div class="comment-date">{{ comment.created_at }}</div>
        </div>
        {% endfor %}
    {% else %}
        <p>No comments yet.</p>
    {% endif %}
</body>
</html>
'''

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = sqlite3.connect('db.sqlite3')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Get recent recipes
        c.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 10
        ''')
        recent_recipes = c.fetchall()
        
        # Get top rated recipes
        c.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            INNER JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING avg_rating IS NOT NULL
            ORDER BY avg_rating DESC
            LIMIT 10
        ''')
        top_recipes = c.fetchall()
        
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
            return jsonify({"error": "Missing required fields"}), 400
        
        if not isinstance(data['ingredients'], list):
            return jsonify({"error": "Ingredients must be an array"}), 400
        
        recipe_id = str(uuid.uuid4())
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
        
        conn.commit()
        conn.close()
        
        # Return the created recipe
        return jsonify({
            "id": recipe_id,
            "title": data['title'],
            "ingredients": data['ingredients'],
            "instructions": data['instructions'],
            "comments": [],
            "avgRating": None
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Get recipe
    c.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe = c.fetchone()
    
    if not recipe:
        conn.close()
        return "Recipe not found", 404
    
    # Get average rating
    c.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    rating_result = c.fetchone()
    avg_rating = rating_result['avg_rating'] if rating_result else None
    
    # Get comments
    c.execute('SELECT comment, created_at FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
    comments = c.fetchall()
    
    conn.close()
    
    recipe_data = {
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'avg_rating': avg_rating,
        'comments': [dict(comment) for comment in comments]
    }
    
    return render_template_string(RECIPE_DETAIL_TEMPLATE, recipe=recipe_data), 200

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        
        if not data or 'comment' not in data:
            return jsonify({"error": "Comment is required"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        # Add comment
        c.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, data['comment']))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        data = request.get_json()
        
        if not data or 'rating' not in data:
            return jsonify({"error": "Rating is required"}), 400
        
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        # Check if recipe exists
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        # Add rating
        c.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return '', 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)