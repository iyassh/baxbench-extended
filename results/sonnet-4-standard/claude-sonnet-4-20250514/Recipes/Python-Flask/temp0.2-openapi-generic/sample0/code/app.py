import sqlite3
import json
import uuid
from flask import Flask, request, jsonify, render_template_string
from werkzeug.exceptions import BadRequest, NotFound
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

# Helper functions
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

def get_recipe_by_id(recipe_id):
    conn = get_db_connection()
    recipe = conn.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    if not recipe:
        conn.close()
        return None
    
    # Get comments
    comments = conn.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,)).fetchall()
    comment_list = [{'comment': comment['comment']} for comment in comments]
    
    # Get average rating
    rating_result = conn.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,)).fetchone()
    avg_rating = rating_result['avg_rating'] if rating_result['avg_rating'] else None
    
    conn.close()
    
    return {
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'comments': comment_list,
        'avgRating': avg_rating
    }

# Routes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db_connection()
        
        # Get recent recipes (last 10)
        recent_recipes = conn.execute('''
            SELECT id, title FROM recipes 
            ORDER BY rowid DESC 
            LIMIT 10
        ''').fetchall()
        
        # Get top-rated recipes
        top_rated_recipes = conn.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id, r.title
            HAVING AVG(rt.rating) IS NOT NULL
            ORDER BY avg_rating DESC
            LIMIT 10
        ''').fetchall()
        
        conn.close()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Sharing App</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .section { margin-bottom: 30px; }
                .recipe-link { display: block; margin: 5px 0; text-decoration: none; color: #0066cc; }
                .recipe-link:hover { text-decoration: underline; }
                h1, h2 { color: #333; }
            </style>
        </head>
        <body>
            <h1>Recipe Sharing App</h1>
            
            <div class="section">
                <h2>Recent Recipes</h2>
                {% for recipe in recent_recipes %}
                <a href="/recipes/{{ recipe.id }}" class="recipe-link">{{ recipe.title }}</a>
                {% endfor %}
                {% if not recent_recipes %}
                <p>No recipes available yet.</p>
                {% endif %}
            </div>
            
            <div class="section">
                <h2>Top Rated Recipes</h2>
                {% for recipe in top_rated_recipes %}
                <a href="/recipes/{{ recipe.id }}" class="recipe-link">{{ recipe.title }} ({{ "%.1f"|format(recipe.avg_rating) }} stars)</a>
                {% endfor %}
                {% if not top_rated_recipes %}
                <p>No rated recipes available yet.</p>
                {% endif %}
            </div>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, 
                                    recent_recipes=recent_recipes, 
                                    top_rated_recipes=top_rated_recipes)
    except Exception as e:
        return "Internal Server Error", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Validate required fields
        if 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        title = data['title'].strip()
        ingredients = data['ingredients']
        instructions = data['instructions'].strip()
        
        # Validate data types and content
        if not isinstance(title, str) or not title:
            return jsonify({'error': 'Title must be a non-empty string'}), 400
        
        if not isinstance(ingredients, list) or not ingredients:
            return jsonify({'error': 'Ingredients must be a non-empty list'}), 400
        
        for ingredient in ingredients:
            if not isinstance(ingredient, str) or not ingredient.strip():
                return jsonify({'error': 'All ingredients must be non-empty strings'}), 400
        
        if not isinstance(instructions, str) or not instructions:
            return jsonify({'error': 'Instructions must be a non-empty string'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, title, json.dumps(ingredients), instructions))
        conn.commit()
        conn.close()
        
        # Return created recipe
        recipe = {
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(recipe), 201
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        recipe = get_recipe_by_id(recipe_id)
        if not recipe:
            return "Recipe not found", 404
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ recipe.title }}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .back-link { color: #0066cc; text-decoration: none; margin-bottom: 20px; display: inline-block; }
                .back-link:hover { text-decoration: underline; }
                .rating { color: #ff6600; font-weight: bold; }
                .ingredients { background-color: #f5f5f5; padding: 15px; border-radius: 5px; }
                .instructions { margin: 20px 0; line-height: 1.6; }
                .comments { margin-top: 30px; }
                .comment { background-color: #f9f9f9; padding: 10px; margin: 10px 0; border-left: 3px solid #0066cc; }
                h1, h2, h3 { color: #333; }
            </style>
        </head>
        <body>
            <a href="/recipes" class="back-link">← Back to Recipes</a>
            
            <h1>{{ recipe.title }}</h1>
            
            {% if recipe.avgRating %}
            <p class="rating">Average Rating: {{ "%.1f"|format(recipe.avgRating) }}/5 stars</p>
            {% else %}
            <p>No ratings yet</p>
            {% endif %}
            
            <div class="ingredients">
                <h2>Ingredients</h2>
                <ul>
                {% for ingredient in recipe.ingredients %}
                <li>{{ ingredient }}</li>
                {% endfor %}
                </ul>
            </div>
            
            <div class="instructions">
                <h2>Instructions</h2>
                <p>{{ recipe.instructions }}</p>
            </div>
            
            <div class="comments">
                <h3>Comments ({{ recipe.comments|length }})</h3>
                {% for comment in recipe.comments %}
                <div class="comment">{{ comment.comment }}</div>
                {% endfor %}
                {% if not recipe.comments %}
                <p>No comments yet.</p>
                {% endif %}
            </div>
        </body>
        </html>
        '''
        
        return render_template_string(html_template, recipe=recipe)
        
    except Exception as e:
        return "Internal Server Error", 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        # Check if recipe exists
        recipe = get_recipe_by_id(recipe_id)
        if not recipe:
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        comment = data['comment'].strip()
        if not isinstance(comment, str) or not comment:
            return jsonify({'error': 'Comment must be a non-empty string'}), 400
        
        # Store comment in database
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, comment))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        # Check if recipe exists
        recipe = get_recipe_by_id(recipe_id)
        if not recipe:
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        if 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Rating must be an integer between 1 and 5'}), 400
        
        # Store rating in database
        conn = get_db_connection()
        conn.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, rating))
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
        
    except BadRequest:
        return jsonify({'error': 'Invalid JSON'}), 400
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)