from flask import Flask, request, jsonify
import sqlite3
import json

app = Flask(__name__)

# Create a connection to the SQLite database
conn = sqlite3.connect('db.sqlite3')
c = conn.cursor()

# Create table
c.execute('''CREATE TABLE IF NOT EXISTS recipes
             (id text PRIMARY KEY, title text, ingredients text, instructions text)''')
c.execute('''CREATE TABLE IF NOT EXISTS comments
             (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id text, comment text)''')
c.execute('''CREATE TABLE IF NOT EXISTS ratings
             (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id text, rating integer)''')

conn.commit()
conn.close()

# Function to get a database connection
def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

# Function to get all recipes
def get_recipes():
    conn = get_db_connection()
    recipes = conn.execute('SELECT * FROM recipes').fetchall()
    conn.close()
    return recipes

# Function to get a recipe by id
def get_recipe(recipe_id):
    conn = get_db_connection()
    recipe = conn.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    conn.close()
    return recipe

# Function to add a new recipe
def add_recipe(title, ingredients, instructions):
    conn = get_db_connection()
    recipe_id = str(len(get_recipes()) + 1)
    conn.execute('INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)',
                 (recipe_id, title, json.dumps(ingredients), instructions))
    conn.commit()
    conn.close()
    return recipe_id

# Function to add a comment to a recipe
def add_comment(recipe_id, comment):
    conn = get_db_connection()
    conn.execute('INSERT INTO comments (recipe_id, comment) VALUES (?, ?)', (recipe_id, comment))
    conn.commit()
    conn.close()

# Function to add a rating to a recipe
def add_rating(recipe_id, rating):
    conn = get_db_connection()
    conn.execute('INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)', (recipe_id, rating))
    conn.commit()
    conn.close()

# Function to get comments for a recipe
def get_comments(recipe_id):
    conn = get_db_connection()
    comments = conn.execute('SELECT * FROM comments WHERE recipe_id = ?', (recipe_id,)).fetchall()
    conn.close()
    return comments

# Function to get ratings for a recipe
def get_ratings(recipe_id):
    conn = get_db_connection()
    ratings = conn.execute('SELECT * FROM ratings WHERE recipe_id = ?', (recipe_id,)).fetchall()
    conn.close()
    return ratings

# API endpoint to get an overview of recipes
@app.route('/recipes', methods=['GET'])
def recipes_overview():
    recipes = get_recipes()
    html = '<h1>Recipes Overview</h1>'
    for recipe in recipes:
        html += f'<p><a href="/recipes/{recipe["id"]}">{recipe["title"]}</a></p>'
    return html

# API endpoint to upload a new recipe
@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    if 'title' not in data or 'ingredients' not in data or 'instructions' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    recipe_id = add_recipe(data['title'], data['ingredients'], data['instructions'])
    return jsonify({'id': recipe_id, 'title': data['title'], 'ingredients': data['ingredients'], 'instructions': data['instructions']}), 201

# API endpoint to get a recipe by id
@app.route('/recipes/<recipe_id>', methods=['GET'])
def get_recipe_by_id(recipe_id):
    recipe = get_recipe(recipe_id)
    if recipe is None:
        return jsonify({'error': 'Recipe not found'}), 404
    comments = get_comments(recipe_id)
    ratings = get_ratings(recipe_id)
    avg_rating = sum([rating['rating'] for rating in ratings]) / len(ratings) if ratings else None
    html = f'<h1>{recipe["title"]}</h1>'
    html += f'<p>Ingredients: {json.loads(recipe["ingredients"])}</p>'
    html += f'<p>Instructions: {recipe["instructions"]}</p>'
    html += '<h2>Comments:</h2>'
    for comment in comments:
        html += f'<p>{comment["comment"]}</p>'
    html += f'<p>Average Rating: {avg_rating}</p>'
    return html

# API endpoint to add a comment to a recipe
@app.route('/recipes/<recipe_id>/comments', methods=['POST'])
def add_comment_to_recipe(recipe_id):
    data = request.get_json()
    if 'comment' not in data:
        return jsonify({'error': 'Invalid input'}), 400
    add_comment(recipe_id, data['comment'])
    return jsonify({'message': 'Comment added successfully'}), 201

# API endpoint to rate a recipe
@app.route('/recipes/<recipe_id>/ratings', methods=['POST'])
def rate_recipe(recipe_id):
    data = request.get_json()
    if 'rating' not in data or not 1 <= data['rating'] <= 5:
        return jsonify({'error': 'Invalid input'}), 400
    add_rating(recipe_id, data['rating'])
    return jsonify({'message': 'Rating added successfully'}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)