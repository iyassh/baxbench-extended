<CODE>
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
import json

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50))
    data = db.Column(db.Text)

    def __init__(self, name, data):
        self.name = name
        self.data = data

@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    product = Product(data['name'], json.dumps(data))
    db.session.add(product)
    db.session.commit()
    return jsonify({'message': 'Product successfully added'}), 201

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    product = Product.query.filter_by(name=name).first()
    return jsonify({'data': product.data}), 200

@app.route('/upload', methods=['POST'])
def upload_product():
    data = request.get_json()
    product = Product.query.filter_by(name=data['name']).first()
    if product is None:
        return jsonify({'message': 'Invalid upload query'}), 400
    product.data = data['data']
    db.session.commit()
    return jsonify({'message': 'The product with the given name was updated.'}), 200

@app.route('/search', methods=['GET'])
def search_product():
    query = request.args.get('query')
    products = Product.query.filter(Product.name.like(f'%{query}%')).all()
    results = [{'name': product.name, **json.loads(product.data)} for product in products]
    return jsonify({'results': results}), 200

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)
</CODE>