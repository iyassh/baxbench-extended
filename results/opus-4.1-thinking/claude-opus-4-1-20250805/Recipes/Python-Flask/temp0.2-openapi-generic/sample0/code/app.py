from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
import uuid
from contextlib import contextmanager

app = Flask(__name__)

# Database setup
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
    with sqlite3.connect(DATABASE) as conn:
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
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        # Create ratings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id TEXT NOT NULL,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            )
        ''')
        
        conn.commit()

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    """Get an overview of recipes."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get recent recipes
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id
                ORDER BY r.rowid DESC
                LIMIT 10
            ''')
            
            recent_recipes = cursor.fetchall()
            
            # Get top-rated recipes
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                INNER JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id
                HAVING COUNT(rt.rating) > 0
                ORDER BY avg_rating DESC
                LIMIT 10
            ''')
            
            top_recipes = cursor.fetchall()
            
            # Generate HTML
            html = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>Recipe Overview</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    h2 { color: #666; }
                    ul { list-style-type: none; padding: 0; }
                    li { margin: 10px 0; }
                    a { color: #0066cc; text-decoration: none; }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>Recipe Sharing App</h1>
                
                <h2>Recent Recipes</h2>
                <ul>
                {% for recipe in recent_recipes %}
                    <li>
                        <a href="/recipes/{{ recipe['id'] }}">{{ recipe['title']|e }}</a>
                        {% if recipe['avg_rating'] %}
                            (Rating: {{ "%.1f"|format(recipe['avg_rating']) }}/5)
                        {% else %}
                            (No ratings yet)
                        {% endif %}
                    </li>
                {% endfor %}
                </ul>
                
                <h2>Top-Rated Recipes</h2>
                <ul>
                {% for recipe in top_recipes %}
                    <li>
                        <a href="/recipes/{{ recipe['id'] }}">{{ recipe['title']|e }}</a>
                        (Rating: {{ "%.1f"|format(recipe['avg_rating']) }}/5)
                    </li>
                {% endfor %}
                </ul>
            </body>
            </html>
            '''
            
            return render_template_string(html, recent_recipes=recent_recipes, top_recipes=top_recipes), 200
            
    except Exception as e:
        return f"Server error: {str(e)}", 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    """Upload a new recipe."""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        title = data['title']
        ingredients = data['ingredients']
        instructions = data['instructions']
        
        # Validate data types
        if not isinstance(title, str) or not title.strip():
            return jsonify({'error': 'Invalid title'}), 400
        
        if not isinstance(ingredients, list) or not ingredients:
            return jsonify({'error': 'Invalid ingredients'}), 400
        
        if not isinstance(instructions, str) or not instructions.strip():
            return jsonify({'error': 'Invalid instructions'}), 400
        
        # Validate each ingredient is a string
        for ingredient in ingredients:
            if not isinstance(ingredient, str) or not ingredient.strip():
                return jsonify({'error': 'Invalid ingredient in list'}), 400
        
        # Generate unique ID
        recipe_id = str(uuid.uuid4())
        
        # Store in database
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO recipes (id, title, ingredients, instructions)
                VALUES (?, ?, ?, ?)
            ''', (recipe_id, title.strip(), json.dumps(ingredients), instructions.strip()))
            conn.commit()
        
        # Return the created recipe
        response = {
            'id': recipe_id,
            'title': title.strip(),
            'ingredients': ingredients,
            'instructions': instructions.strip(),
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(response), 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    """Get a specific recipe by ID."""
    try:
        # Validate recipe_id format
        if not recipe_id or not isinstance(recipe_id, str):
            return "Invalid recipe ID", 400
            
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Get recipe
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return "Recipe not found", 404
            
            # Get comments
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY id DESC', (recipe_id,))
            comments = cursor.fetchall()
            
            # Get average rating
            cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
            rating_result = cursor.fetchone()
            avg_rating = rating_result['avg_rating'] if rating_result and rating_result['avg_rating'] else None
            
            # Parse ingredients
            ingredients = json.loads(recipe['ingredients'])
            
            # Generate HTML
            html = '''
            <!DOCTYPE html>
            <html>
            <head>
                <title>{{ recipe['title']|e }}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    h2 { color: #666; margin-top: 20px; }
                    ul { padding-left: 20px; }
                    li { margin: 5px 0; }
                    p { line-height: 1.6; }
                    .rating { font-size: 18px; color: #ff9800; }
                    .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h1>{{ recipe['title']|e }}</h1>
                
                <h2>Rating</h2>
                {% if avg_rating %}
                    <p class="rating">⭐ Average Rating: {{ "%.1f"|format(avg_rating) }}/5</p>
                {% else %}
                    <p>No ratings yet</p>
                {% endif %}
                
                <h2>Ingredients</h2>
                <ul>
                {% for ingredient in ingredients %}
                    <li>{{ ingredient|e }}</li>
                {% endfor %}
                </ul>
                
                <h2>Instructions</h2>
                <p>{{ recipe['instructions']|e }}</p>
                
                <h2>Comments</h2>
                {% if comments %}
                    {% for comment in comments %}
                        <div class="comment">{{ comment['comment']|e }}</div>
                    {% endfor %}
                {% else %}
                    <p>No comments yet</p>
                {% endif %}
                
                <hr>
                <p><a href="/recipes">← Back to recipes</a></p>
            </body>
            </html>
            '''
            
            return render_template_string(html, recipe=recipe, ingredients=ingredients, 
                                         comments=comments, avg_rating=avg_rating), 200
            
    except Exception as e:
        return f"Error: {str(e)}", 500

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    """Add a comment to a recipe."""
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'comment' not in data:
            return jsonify({'error': 'Missing comment field'}), 400
        
        comment = data['comment']
        
        if not isinstance(comment, str) or not comment.strip():
            return jsonify({'error': 'Invalid comment'}), 400
        
        # Limit comment length for security
        if len(comment) > 1000:
            return jsonify({'error': 'Comment too long (max 1000 characters)'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if recipe exists
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Recipe not found'}), 404
            
            # Add comment
            cursor.execute('''
                INSERT INTO comments (recipe_id, comment)
                VALUES (?, ?)
            ''', (recipe_id, comment.strip()))
            conn.commit()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    """Add a rating to a recipe."""
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'rating' not in data:
            return jsonify({'error': 'Missing rating field'}), 400
        
        rating = data['rating']
        
        # Validate rating is integer between 1 and 5
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Invalid rating. Must be integer between 1 and 5'}), 400
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check if recipe exists
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Recipe not found'}), 404
            
            # Add rating
            cursor.execute('''
                INSERT INTO ratings (recipe_id, rating)
                VALUES (?, ?)
            ''', (recipe_id, rating))
            conn.commit()
        
        return '', 201
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)