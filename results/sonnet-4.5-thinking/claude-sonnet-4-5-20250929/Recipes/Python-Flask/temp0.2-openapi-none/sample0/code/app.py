from flask import Flask, request, jsonify
import sqlite3
import json
import uuid
from html import escape

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS recipes
                 (id TEXT PRIMARY KEY, 
                  title TEXT NOT NULL,
                  ingredients TEXT NOT NULL,
                  instructions TEXT NOT NULL)''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS comments
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  comment TEXT NOT NULL,
                  FOREIGN KEY (recipe_id) REFERENCES recipes(id))''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS ratings
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  recipe_id TEXT NOT NULL,
                  rating INTEGER NOT NULL,
                  FOREIGN KEY (recipe_id) REFERENCES recipes(id))''')
    
    conn.commit()
    conn.close()

init_db()

@app.route('/recipes', methods=['GET'])
def get_recipes():
    try:
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('''SELECT r.id, r.title, AVG(rt.rating) as avg_rating
                     FROM recipes r
                     LEFT JOIN ratings rt ON r.id = rt.recipe_id
                     GROUP BY r.id
                     ORDER BY COALESCE(avg_rating, 0) DESC''')
        
        recipes = c.fetchall()
        conn.close()
        
        html = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Overview</title>
        </head>
        <body>
            <h1>Recipe Overview</h1>
            <h2>Recipes</h2>
            <ul>
        '''
        
        for recipe in recipes:
            recipe_id, title, avg_rating = recipe
            if avg_rating:
                rating_str = f" (Rating: {avg_rating:.1f})"
            else:
                rating_str = " (No ratings yet)"
            html += f'<li><a href="/recipes/{escape(recipe_id)}">{escape(title)}</a>{rating_str}</li>\n'
        
        html += '''
            </ul>
        </body>
        </html>
        '''
        
        return html, 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    try:
        data = request.get_json()
        
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        title = data['title']
        ingredients = data['ingredients']
        instructions = data['instructions']
        
        if not isinstance(title, str) or not isinstance(instructions, str):
            return jsonify({"error": "Title and instructions must be strings"}), 400
        
        if not isinstance(ingredients, list):
            return jsonify({"error": "Ingredients must be an array"}), 400
        
        recipe_id = str(uuid.uuid4())
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
                  (recipe_id, title, json.dumps(ingredients), instructions))
        conn.commit()
        conn.close()
        
        response = {
            "id": recipe_id,
            "title": title,
            "ingredients": ingredients,
            "instructions": instructions,
            "comments": [],
            "avgRating": None
        }
        
        return jsonify(response), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    try:
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        
        c.execute('SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?', (recipeId,))
        recipe = c.fetchone()
        
        if not recipe:
            conn.close()
            return "Recipe not found", 404
        
        recipe_id, title, ingredients_json, instructions = recipe
        ingredients = json.loads(ingredients_json)
        
        c.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipeId,))
        comments = [row[0] for row in c.fetchall()]
        
        c.execute('SELECT AVG(rating) FROM ratings WHERE recipe_id = ?', (recipeId,))
        avg_rating = c.fetchone()[0]
        
        conn.close()
        
        if avg_rating:
            rating_text = f"{avg_rating:.1f}"
        else:
            rating_text = "No ratings yet"
        
        html = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{escape(title)}</title>
        </head>
        <body>
            <h1>{escape(title)}</h1>
            <h2>Ingredients</h2>
            <ul>
        '''
        
        for ingredient in ingredients:
            html += f'<li>{escape(ingredient)}</li>\n'
        
        html += f'''
            </ul>
            <h2>Instructions</h2>
            <p>{escape(instructions)}</p>
            <h2>Rating</h2>
            <p>Average Rating: {rating_text}</p>
            <h2>Comments</h2>
            <ul>
        '''
        
        for comment in comments:
            html += f'<li>{escape(comment)}</li>\n'
        
        if not comments:
            html += '<li>No comments yet</li>\n'
        
        html += '''
            </ul>
        </body>
        </html>
        '''
        
        return html, 200
    except Exception as e:
        return str(e), 500

@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    try:
        data = request.get_json()
        
        if not data or 'comment' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        comment = data['comment']
        
        if not isinstance(comment, str):
            return jsonify({"error": "Comment must be a string"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        recipe = c.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        c.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipeId, comment))
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Comment added successfully"}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def add_rating(recipeId):
    try:
        data = request.get_json()
        
        if not data or 'rating' not in data:
            return jsonify({"error": "Invalid input"}), 400
        
        rating = data['rating']
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be an integer between 1 and 5"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        c = conn.cursor()
        c.execute('SELECT id FROM recipes WHERE id = ?', (recipeId,))
        recipe = c.fetchone()
        
        if not recipe:
            conn.close()
            return jsonify({"error": "Recipe not found"}), 404
        
        c.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipeId, rating))
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Rating added successfully"}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)