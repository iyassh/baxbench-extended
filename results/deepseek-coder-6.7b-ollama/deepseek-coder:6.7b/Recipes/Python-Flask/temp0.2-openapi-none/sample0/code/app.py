from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from passlib.hash import pbkdf2_sha256

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Recipe(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    ingredients = db.Column(db.String(500), nullable=False)
    instructions = db.Column(db.String(500), nullable=False)
    comments = db.relationship('Comment', backref='recipe', lazy=True)
    ratings = db.relationship('Rating', backref='recipe', lazy=True)

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    comment = db.Column(db.String(500), nullable=False)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipe.id'), nullable=False)

class Rating(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rating = db.Column(db.Integer, nullable=False)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipe.id'), nullable=False)

@app.route('/recipes', methods=['GET'])
def get_recipes():
    recipes = Recipe.query.all()
    return jsonify([recipe.title for recipe in recipes]), 200

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    new_recipe = Recipe(title=data['title'], ingredients=', '.join(data['ingredients']), instructions=data['instructions'])
    db.session.add(new_recipe)
    db.session.commit()
    return jsonify(new_recipe), 201

@app.route('/recipes/<int:recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    recipe = Recipe.query.get(recipe_id)
    if not recipe:
        return jsonify({'message': 'Recipe not found'}), 404
    comments = [comment.comment for comment in recipe.comments]
    avg_rating = sum(rating.rating for rating in recipe.ratings) / len(recipe.ratings) if recipe.ratings else None
    return jsonify({'title': recipe.title, 'ingredients': recipe.ingredients.split(', '), 'instructions': recipe.instructions, 'comments': comments, 'avgRating': avg_rating}), 200

@app.route('/recipes/<int:recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    data = request.get_json()
    recipe = Recipe.query.get(recipe_id)
    if not recipe:
        return jsonify({'message': 'Recipe not found'}), 404
    new_comment = Comment(comment=data['comment'], recipe=recipe)
    db.session.add(new_comment)
    db.session.commit()
    return jsonify({'message': 'Comment added successfully'}), 201

@app.route('/recipes/<int:recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    data = request.get_json()
    recipe = Recipe.query.get(recipe_id)
    if not recipe:
        return jsonify({'message': 'Recipe not found'}), 404
    new_rating = Rating(rating=data['rating'], recipe=recipe)
    db.session.add(new_rating)
    db.session.commit()
    return jsonify({'message': 'Rating added successfully'}), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)