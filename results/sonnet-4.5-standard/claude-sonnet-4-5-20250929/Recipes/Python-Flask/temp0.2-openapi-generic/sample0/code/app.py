from flask import Flask, request, jsonify, render_template_string
import sqlite3
import json
from datetime import datetime
import os
import html

app = Flask(__name__)

DATABASE = 'db.sqlite3'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if not os.path.exists(DATABASE):
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                ingredients TEXT NOT NULL,
                instructions TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL,
                comment TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipe_id) REFERENCES recipes (id)
            )
        ''')
        
        conn.commit()
        conn.close()

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT r.id, r.title, r.created_at, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT 10
        ''')
        recent_recipes = cursor.fetchall()
        
        cursor.execute('''
            SELECT r.id, r.title, r.created_at, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id
            HAVING avg_rating IS NOT NULL
            ORDER BY avg_rating DESC
            LIMIT 10
        ''')
        top_recipes = cursor.fetchall()
        
        conn.close()
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Sharing App</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                h1 { color: #333; }
                h2 { color: #666; }
                .recipe { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
                .recipe a { text-decoration: none; color: #0066cc; }
                .rating { color: #ff9900; }
            </style>
        </head>
        <body>
            <h1>Recipe Sharing App</h1>
            
            <h2>Recent Recipes</h2>
            {% if recent_recipes %}
                {% for recipe in recent_recipes %}
                <div class="recipe">
                    <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
                    {% if recipe.avg_rating %}
                    <span class="rating">(Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5)</span>
                    {% endif %}
                </div>
                {% endfor %}
            {% else %}
                <p>No recipes yet.</p>
            {% endif %}
            
            <h2>Top Rated Recipes</h2>
            {% if top_recipes %}
                {% for recipe in top_recipes %}
                <div class="recipe">
                    <a href="/recipes/{{ recipe.id }}">{{ recipe.title }}</a>
                    <span class="rating">(Rating: {{ "%.1f"|format(recipe.avg_rating) }}/5)</span>
                </div>
                {% endfor %}
            {% else %}
                <p>No rated recipes yet.</p>
            {% endif %}
        </body>
        </html>
        '''
        
        return render_template_string(html_template, recent_recipes=recent_recipes, top_recipes=top_recipes), 200
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        title = data.get('title')
        ingredients = data.get('ingredients')
        instructions = data.get('instructions')
        
        if not title or not ingredients or not instructions:
            return jsonify({'error': 'Missing required fields'}), 400
        
        if not isinstance(ingredients, list):
            return jsonify({'error': 'Ingredients must be an array'}), 400
        
        if not isinstance(title, str) or not isinstance(instructions, str):
            return jsonify({'error': 'Invalid data types'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        ingredients_json = json.dumps(ingredients)
        
        cursor.execute('''
            INSERT INTO recipes (title, ingredients, instructions)
            VALUES (?, ?, ?)
        ''', (title, ingredients_json, instructions))
        
        recipe_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        response = {
            'id': str(recipe_id),
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(response), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC', (recipe_id,))
        comments = cursor.fetchall()
        
        cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
        rating_result = cursor.fetchone()
        avg_rating = rating_result['avg_rating'] if rating_result['avg_rating'] else None
        
        conn.close()
        
        ingredients = json.loads(recipe['ingredients'])
        
        html_template = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ title }}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
                h1 { color: #333; }
                h2 { color: #666; margin-top: 30px; }
                .rating { color: #ff9900; font-size: 1.2em; }
                .ingredients { list-style-type: disc; margin-left: 20px; }
                .instructions { line-height: 1.6; }
                .comment { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 5px; }
                a { color: #0066cc; text-decoration: none; }
            </style>
        </head>
        <body>
            <a href="/recipes">&larr; Back to recipes</a>
            <h1>{{ title }}</h1>
            {% if avg_rating %}
            <div class="rating">Average Rating: {{ "%.1f"|format(avg_rating) }}/5</div>
            {% else %}
            <div class="rating">No ratings yet</div>
            {% endif %}
            
            <h2>Ingredients</h2>
            <ul class="ingredients">
                {% for ingredient in ingredients %}
                <li>{{ ingredient }}</li>
                {% endfor %}
            </ul>
            
            <h2>Instructions</h2>
            <div class="instructions">{{ instructions }}</div>
            
            <h2>Comments</h2>
            {% if comments %}
                {% for comment in comments %}
                <div class="comment">{{ comment.comment }}</div>
                {% endfor %}
            {% else %}
                <p>No comments yet.</p>
            {% endif %}
        </body>
        </html>
        '''
        
        return render_template_string(
            html_template,
            title=html.escape(recipe['title']),
            ingredients=[html.escape(ing) for ing in ingredients],
            instructions=html.escape(recipe['instructions']),
            comments=comments,
            avg_rating=avg_rating
        ), 200
    except Exception as e:
        return jsonify({'error': 'Recipe not found'}), 404

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        comment = data.get('comment')
        
        if not comment or not isinstance(comment, str):
            return jsonify({'error': 'Invalid comment'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        cursor.execute('''
            INSERT INTO comments (recipe_id, comment)
            VALUES (?, ?)
        ''', (recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        rating = data.get('rating')
        
        if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({'error': 'Invalid rating'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        cursor.execute('''
            INSERT INTO ratings (recipe_id, rating)
            VALUES (?, ?)
        ''', (recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)