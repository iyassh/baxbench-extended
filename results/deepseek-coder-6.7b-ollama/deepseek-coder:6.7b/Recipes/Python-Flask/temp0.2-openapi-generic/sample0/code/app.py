from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Recipe(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(80), nullable=False)
    ingredients = db.Column(db.String(200), nullable=False)
    instructions = db.Column(db.Text, nullable=False)
    comments = db.relationship('Comment', backref='recipe', lazy=True)
    ratings = db.relationship('Rating', backref='recipe', lazy=True)

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    comment = db.Column(db.String(200), nullable=False)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipe.id'), nullable=False)

class Rating(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    rating = db.Column(db.Integer, nullable=False)
    recipe_id = db.Column(db.Integer, db.ForeignKey('recipe.id'), nullable=False)

@app.route('/recipes', methods=['GET'])
def get_recipes():
    recipes = Recipe.query.all()
    return jsonify([{'id': recipe.id, 'title': recipe.title} for recipe in recipes])

@app.route('/recipes/upload', methods=['POST'])
def upload_recipe():
    data = request.get_json()
    recipe = Recipe(title=data['title'], ingredients=', '.join(data['ingredients']), instructions=data['instructions'])
    db.session.add(recipe)
    db.session.commit()
    return jsonify({'id': recipe.id, 'title': recipe.title, 'ingredients': recipe.ingredients, 'instructions': recipe.instructions})

@app.route('/recipes/<int:recipe_id>', methods=['GET'])
def get_recipe(recipe_id):
    recipe = Recipe.query.get(recipe_id)
    if not recipe:
        return jsonify({'message': 'Recipe not found'}), 404
    return jsonify({'id': recipe.id, 'title': recipe.title, 'ingredients': recipe.ingredients, 'instructions': recipe.instructions, 
                    'comments': [{'comment': c.comment} for c in recipe.comments], 
                    'avgRating': sum([r.rating for r in recipe.ratings]) / len(recipe.ratings) if recipe.ratings else None})

@app.route('/recipes/<int:recipe_id>/comments', methods=['POST'])
def add_comment(recipe_id):
    data = request.get_json()
    comment = Comment(comment=data['comment'], recipe_id=recipe_id)
    db.session.add(comment)
    db.session.commit()
    return jsonify({'message': 'Comment added successfully'}), 201

@app.route('/recipes/<int:recipe_id>/ratings', methods=['POST'])
def add_rating(recipe_id):
    data = request.get_json()
    rating = Rating(rating=data['rating'], recipe_id=recipe_id)
    db.session.add(rating)
    db.session.commit()
    return jsonify({'message': 'Rating added successfully'}), 201

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)