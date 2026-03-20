import sqlite3
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, render_string
from statistics import mean

app = Flask(__name__)
DATABASE = 'db.sqlite3'

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id TEXT PRIMARY KEY,
            recipe_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
        )
    ''')
    
    conn.commit()
    conn.close()

def get_recipe_with_details(recipe_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
    recipe = cursor.fetchone()
    
    if not recipe:
        conn.close()
        return None
    
    cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
    comments = [row['comment'] for row in cursor.fetchall()]
    
    cursor.execute('SELECT rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
    ratings = [row['rating'] for row in cursor.fetchall()]
    
    conn.close()
    
    avg_rating = mean(ratings) if ratings else None
    
    return {
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'comments': comments,
        'avgRating': avg_rating
    }

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT r.id, r.title FROM recipes r
            ORDER BY r.created_at DESC
            LIMIT 10
        ''')
        recipes = cursor.fetchall()
        
        conn.close()
        
        html = '<html><head><title>Recipe Overview</title></head><body>'
        html += '<h1>Recent Recipes</h1><ul>'
        
        for recipe in recipes:
            html += f'<li><a href="/recipes/{recipe["id"]}">{recipe["title"]}</a></li>'
        
        html += '</ul></body></html>'
        
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return jsonify({'error': 'Server error'}), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({'error': 'Invalid input'}), 400
        
        title = data.get('title')
        ingredients = data.get('ingredients')
        instructions = data.get('instructions')
        
        if not isinstance(ingredients, list) or not all(isinstance(i, str) for i in ingredients):
            return jsonify({'error': 'Invalid input'}), 400
        
        if not isinstance(title, str) or not isinstance(instructions, str):
            return jsonify({'error': 'Invalid input'}), 400
        
        recipe_id = str(uuid.uuid4())
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO recipes (id, title, ingredients, instructions)
            VALUES (?, ?, ?, ?)
        ''', (recipe_id, title, json.dumps(ingredients), instructions))
        
        conn.commit()
        conn.close()
        
        recipe = {
            'id': recipe_id,
            'title': title,
            'ingredients': ingredients,
            'instructions': instructions,
            'comments': [],
            'avgRating': None
        }
        
        return jsonify(recipe), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        recipe = get_recipe_with_details(recipe_id)
        
        if not recipe:
            return jsonify({'error': 'Recipe not found'}), 404
        
        html = '<html><head><title>' + recipe['title'] + '</title></head><body>'
        html += '<h1>' + recipe['title'] + '</h1>'
        html += '<h2>Ingredients</h2><ul>'
        
        for ingredient in recipe['ingredients']:
            html += '<li>' + ingredient + '</li>'
        
        html += '</ul><h2>Instructions</h2><p>' + recipe['instructions'] + '</p>'
        
        if recipe['comments']:
            html += '<h2>Comments</h2><ul>'
            for comment in recipe['comments']:
                html += '<li>' + comment + '</li>'
            html += '</ul>'
        
        if recipe['avgRating'] is not None:
            html += '<p>Average Rating: ' + str(recipe['avgRating']) + '</p>'
        
        html += '</body></html>'
        
        return html, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return jsonify({'error': 'Recipe not found'}), 404

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        
        if not data or 'comment' not in data:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
        
        comment = data.get('comment')
        
        if not isinstance(comment, str):
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
        
        comment_id = str(uuid.uuid4())
        
        cursor.execute('''
            INSERT INTO comments (id, recipe_id, comment)
            VALUES (?, ?, ?)
        ''', (comment_id, recipe_id, comment))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Comment added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({'error': 'Recipe not found'}), 404
        
        data = request.get_json()
        
        if not data or 'rating' not in data:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
        
        rating = data.get('rating')
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            conn.close()
            return jsonify({'error': 'Invalid input'}), 400
        
        rating_id = str(uuid.uuid4())
        
        cursor.execute('''
            INSERT INTO ratings (id, recipe_id, rating)
            VALUES (?, ?, ?)
        ''', (rating_id, recipe_id, rating))
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Rating added successfully'}), 201
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)