from flask import Flask, request, jsonify
import sqlite3
import json

app = Flask(__name__)

# Create a connection to the SQLite database
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Create the recipes table if it doesn't exist
def create_recipes_table():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS recipes
        (id TEXT PRIMARY KEY, title TEXT, ingredients TEXT, instructions TEXT)
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS comments
        (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT, comment TEXT)
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS ratings
        (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT, rating INTEGER)
    ''')
    conn.close()

create_recipes_table()

# Get an overview of recipes
@app.route('/recipes', methods=['GET'])
def get_recipes():
    conn = get_db_connection()
    recipes = conn.execute('SELECT * FROM recipes').fetchall()
    conn.close()
    return jsonify([dict(row) for row in recipes])

# Upload a new recipe
@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    if 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    conn.execute('INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
                 (str(len(conn.execute('SELECT * FROM recipes').fetchall()) + 1), data['title'], json.dumps(data['ingredients']), data['instructions']))
    conn.commit()
    conn.close()
    return jsonify({'id': str(len(conn.execute('SELECT * FROM recipes').fetchall()))}), 201

# Get a recipe
@app.route('/recipes/<recipeId>', methods=['GET'])
def get_recipe(recipeId):
    conn = get_db_connection()
    recipe = conn.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if recipe is None:
        return jsonify({'error': 'Recipe not found'}), 404
    comments = conn.execute('SELECT * FROM comments WHERE recipe_id = ?', (recipeId,)).fetchall()
    ratings = conn.execute('SELECT * FROM ratings WHERE recipe_id = ?', (recipeId,)).fetchall()
    avg_rating = sum([row['rating'] for row in ratings]) / len(ratings) if ratings else None
    conn.close()
    return jsonify({
        'id': recipe['id'],
        'title': recipe['title'],
        'ingredients': json.loads(recipe['ingredients']),
        'instructions': recipe['instructions'],
        'comments': [dict(row) for row in comments],
        'avgRating': avg_rating
    })

# Add a comment to a recipe
@app.route('/recipes/<recipeId>/comments', methods=['POST'])
def add_comment(recipeId):
    data = request.get_json()
    if 'comment' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    recipe = conn.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if recipe is None:
        return jsonify({'error': 'Recipe not found'}), 404
    conn.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipeId, data['comment']))
    conn.commit()
    conn.close()
    return jsonify({}), 201

# Rate a recipe
@app.route('/recipes/<recipeId>/ratings', methods=['POST'])
def rate_recipe(recipeId):
    data = request.get_json()
    if 'rating' not in data or not isinstance(data['rating'], int) or data['rating'] < 1 or data['rating'] > 5:
        return jsonify({'error': 'Invalid input'}), 400
    conn = get_db_connection()
    recipe = conn.execute('SELECT * FROM recipes WHERE id = ?', (recipeId,)).fetchone()
    if recipe is None:
        return jsonify({'error': 'Recipe not found'}), 404
    conn.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipeId, data['rating']))
    conn.commit()
    conn.close()
    return jsonify({}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)