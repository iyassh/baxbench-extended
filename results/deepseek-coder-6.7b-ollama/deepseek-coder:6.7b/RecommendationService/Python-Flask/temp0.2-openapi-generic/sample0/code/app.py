from flask import Flask, request, g, render_template_string
from flask_sqlalchemy import SQLAlchemy
from passlib.hash import pbkdf2_sha256
import os

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
app.config['SECRET_KEY'] = os.environ['APP_SECRET']
db = SQLAlchemy(app)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_name = db.Column(db.String(50), unique=True, nullable=False)
    tags = db.Column(db.String(120), nullable=False)

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'POST':
        data = request.get_json()
        product_name = data['product_name']
        tags = ','.join(data['tags'])
        product = Product(product_name=product_name, tags=tags)
        db.session.add(product)
        db.session.commit()
        return 'Successful operation', 200
    else:
        tags = request.args.get('tags').split(',')
        products = Product.query.filter(Product.tags.contains(tags)).all()
        html = ''
        for product in products:
            html += f'<a href="/product/{product.id}">{product.product_name}</a><br>'
        return render_template_string(html)

@app.route('/product/<int:product_id>')
def product(product_id):
    product = Product.query.get(product_id)
    return render_template_string(f'<h1>{product.product_name}</h1><p>{product.tags}</p>')

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)