from flask import Flask, request, jsonify
import sqlite3
import json
import html

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            instructions TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL,
            comment TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            FOREIGN KEY (recipe_id) REFERENCES recipes (id)
        )
    ''')
    
    conn.commit()
    conn.close()

# GET /recipes
@app.route('/recipes', methods=['GET'])
def get_recipes_overview():
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get recent recipes
        cursor.execute('''
            SELECT r.id, r.title, AVG(rt.rating) as avg_rating
            FROM recipes r
            LEFT JOIN ratings rt ON r.id = rt.recipe_id
            GROUP BY r.id, r.title
            ORDER BY r.id DESC
            LIMIT 10
        ''')
        recipes = cursor.fetchall()
        
        html_content = '''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Recipe Sharing App</title>
        </head>
        <body>
            <h1>Recent Recipes</h1>
            <ul>
        '''
        
        if recipes:
            for recipe in recipes:
                recipe_id, title, avg_rating = recipe
                rating_text = f" (Rating: {avg_rating:.1f})" if avg_rating else " (No ratings yet)"
                html_content += f'<li><a href="/recipes/{recipe_id}">{html.escape(title)}</a>{rating_text}</li>'
        else:
            html_content += '<li>No recipes yet!</li>'
        
        html_content += '''
            </ul>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return "Server error", 500
    finally:
        if conn:
            conn.close()

# POST /recipes/upload
@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    conn = None
    try:
        data = request.get_json()
        
        # Validate input
        if not data or 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        title = data['title']
        ingredients = data['ingredients']
        instructions = data['instructions']
        
        if not isinstance(ingredients, list):
            return jsonify({"error": "Ingredients must be a list"}), 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Insert recipe
        cursor.execute('''
            INSERT INTO recipes (title, ingredients, instructions)
            VALUES (?, ?, ?)
        ''', (title, json.dumps(ingredients), instructions))
        
        recipe_id = cursor.lastrowid
        conn.commit()
        
        # Return recipe data
        response_data = {
            "id": str(recipe_id),
            "title": title,
            "ingredients": ingredients,
            "instructions": instructions,
            "comments": [],
            "avgRating": None
        }
        
        return jsonify(response_data), 201
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400
    finally:
        if conn:
            conn.close()

# GET /recipes/{recipeId}
@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    conn = None
    try:
        # Validate recipe_id is numeric
        try:
            int(recipe_id)
        except ValueError:
            return "Recipe not found", 404
            
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Get recipe
        cursor.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,))
        recipe = cursor.fetchone()
        
        if not recipe:
            return "Recipe not found", 404
        
        # Get comments
        cursor.execute('SELECT comment FROM comments WHERE recipe_id = ?', (recipe_id,))
        comments = [row[0] for row in cursor.fetchall()]
        
        # Get average rating
        cursor.execute('SELECT AVG(rating) FROM ratings WHERE recipe_id = ?', (recipe_id,))
        avg_rating = cursor.fetchone()[0]
        
        # Parse ingredients
        ingredients = json.loads(recipe[2])
        
        html_content = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>{html.escape(recipe[1])} - Recipe</title>
        </head>
        <body>
            <h1>{html.escape(recipe[1])}</h1>
            <h2>Ingredients:</h2>
            <ul>
        '''
        
        for ingredient in ingredients:
            html_content += f'<li>{html.escape(ingredient)}</li>'
        
        html_content += f'''
            </ul>
            <h2>Instructions:</h2>
            <p>{html.escape(recipe[3])}</p>
            <h2>Rating:</h2>
            <p>{'%.1f' % avg_rating if avg_rating else 'No ratings yet'}</p>
            <h2>Comments:</h2>
        '''
        
        if comments:
            html_content += '<ul>'
            for comment in comments:
                html_content += f'<li>{html.escape(comment)}</li>'
            html_content += '</ul>'
        else:
            html_content += '<p>No comments yet!</p>'
        
        html_content += '''
            <p><a href="/recipes">Back to recipes</a></p>
        </body>
        </html>
        '''
        
        return html_content, 200, {'Content-Type': 'text/html'}
    except Exception as e:
        return "Recipe not found", 404
    finally:
        if conn:
            conn.close()

# POST /recipes/{recipeId}/comments
@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    conn = None
    try:
        # Validate recipe_id is numeric
        try:
            int(recipe_id)
        except ValueError:
            return "", 404
            
        data = request.get_json()
        
        if not data or 'comment' not in data:
            return "", 400
        
        comment = data['comment']
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            return "", 404
        
        # Insert comment
        cursor.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipe_id, comment))
        conn.commit()
        
        return "", 201
    except Exception as e:
        return "", 400
    finally:
        if conn:
            conn.close()

# POST /recipes/{recipeId}/ratings
@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    conn = None
    try:
        # Validate recipe_id is numeric
        try:
            int(recipe_id)
        except ValueError:
            return "", 404
            
        data = request.get_json()
        
        if not data or 'rating' not in data:
            return "", 400
        
        rating = data['rating']
        
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            return "", 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Check if recipe exists
        cursor.execute('SELECT id FROM recipes WHERE id = ?', (recipe_id,))
        if not cursor.fetchone():
            return "", 404
        
        # Insert rating
        cursor.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipe_id, rating))
        conn.commit()
        
        return "", 201
    except Exception as e:
        return "", 400
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)