from flask import Flask, request, jsonify
import sqlite3
import json
import uuid
import html
from contextlib import contextmanager

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@contextmanager
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                FROM recipes r
                LEFT JOIN ratings rt ON r.id = rt.recipe_id
                GROUP BY r.id, r.title
                ORDER BY avg_rating DESC NULLS LAST
            ''')
            recipes = cursor.fetchall()
            
        html_content = '''<!DOCTYPE html>
<html>
<head>
    <title>Recipe Sharing App</title>
</head>
<body>
    <h1>Recipe Overview</h1>'''
        
        if recipes:
            html_content += '<ul>'
            for recipe in recipes:
                escaped_title = html.escape(recipe['title'])
                rating_text = f" (Rating: {recipe['avg_rating']:.1f})" if recipe['avg_rating'] else " (No ratings yet)"
                html_content += f'<li><a href="/recipes/{recipe["id"]}">{escaped_title}</a>{rating_text}</li>'
            html_content += '</ul>'
        else:
            html_content += '<p>No recipes available.</p>'
            
        html_content += '''</body>
</html>'''
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception:
        return '', 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        if not data:
            return '', 400
            
        if not all(k in data for k in ['title', 'ingredients', 'instructions']):
            return '', 400
            
        if not isinstance(data['ingredients'], list):
            return '', 400
            
        if not isinstance(data['title'], str) or not isinstance(data['instructions'], str):
            return '', 400
            
        if not all(isinstance(ingredient, str) for ingredient in data['ingredients']):
            return '', 400
            
        recipe_id = str(uuid.uuid4())
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO recipes (id, title, ingredients, instructions)
                VALUES (?, ?, ?, ?)
            ''', (recipe_id, data['title'], json.dumps(data['ingredients']), data['instructions']))
            conn.commit()
            
        response = {
            "id": recipe_id,
            "title": data['title'],
            "ingredients": data['ingredients'],
            "instructions": data['instructions'],
            "comments": [],
            "avgRating": None
        }
        
        return jsonify(response), 201
    except Exception:
        return '', 400

@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
            recipe = cursor.fetchone()
            
            if not recipe:
                return '', 404
                
            cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
            comments = [row['comment'] for row in cursor.fetchall()]
            
            cursor.execute('SELECT AVG(rating) as avg_rating FROM ratings WHERE recipe_id = ?', (recipe_id,))
            avg_rating = cursor.fetchone()['avg_rating']
            
        ingredients = json.loads(recipe['ingredients'])
        
        html_content = f'''<!DOCTYPE html>
<html>
<head>
    <title>{html.escape(recipe["title"])} - Recipe</title>
</head>
<body>
    <h1>{html.escape(recipe["title"])}</h1>
    <h2>Ingredients:</h2>
    <ul>'''
        
        for ingredient in ingredients:
            html_content += f'<li>{html.escape(ingredient)}</li>'
            
        html_content += f'''</ul>
    <h2>Instructions:</h2>
    <p>{html.escape(recipe["instructions"])}</p>'''
        
        if avg_rating:
            html_content += f'<p><strong>Average Rating: {avg_rating:.1f}/5</strong></p>'
        else:
            html_content += '<p><strong>No ratings yet</strong></p>'
            
        if comments:
            html_content += '<h2>Comments:</h2><ul>'
            for comment in comments:
                html_content += f'<li>{html.escape(comment)}</li>'
            html_content += '</ul>'
        else:
            html_content += '<p>No comments yet.</p>'
            
        html_content += '''<a href="/recipes">Back to Recipe Overview</a>
</body>
</html>'''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception:
        return '', 404

@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    try:
        data = request.get_json()
        if not data or 'comment' not in data:
            return '', 400
            
        if not isinstance(data['comment'], str):
            return '', 400
            
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return '', 404
                
            cursor.execute('''
                INSERT INTO comments (recipe_id, comment)
                VALUES (?, ?)
            ''', (recipe_id, data['comment']))
            conn.commit()
            
        return '', 201
    except Exception:
        return '', 400

@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    try:
        data = request.get_json()
        if not data or 'rating' not in data:
            return '', 400
            
        rating = data['rating']
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return '', 400
            
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
            if not cursor.fetchone():
                return '', 404
                
            cursor.execute('''
                INSERT INTO ratings (recipe_id, rating)
                VALUES (?, ?)
            ''', (recipe_id, rating))
            conn.commit()
            
        return '', 201
    except Exception:
        return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)