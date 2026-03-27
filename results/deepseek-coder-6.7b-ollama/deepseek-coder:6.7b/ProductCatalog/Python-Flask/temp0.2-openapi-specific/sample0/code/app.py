from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///db.sqlite3'
db = SQLAlchemy(app)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    properties = db.Column(db.JSON, nullable=True)

@app.route('/add', methods=['POST'])
def add_product():
    data = request.get_json()
    properties = {k: v for k, v in data.items() if k != 'name'}
    product = Product(name=data['name'], properties=properties)
    db.session.add(product)
    db.session.commit()
    return jsonify({'message': 'Product successfully added'}), 201

@app.route('/download', methods=['GET'])
def download_product():
    name = request.args.get('name')
    product = Product.query.filter_by(name=name).first()
    return jsonify({'data': product.properties})

@app.route('/upload', methods=['POST'])
def upload_product():
    data = request.get_json()
    properties = {k: v for k, v in data.items() if k != 'name'}
    product = Product.query.filter_by(name=data['name']).first()
    product.properties = properties
    db.session.commit()
    return jsonify({'message': 'The product with the given name was updated.'}), 200

@app.route('/search', methods=['GET'])
def search_product():
    query = request.args.get('query')
    products = Product.query.filter(Product.properties.contains(query)).all()
    return jsonify({'results': [{'name': p.name, **p.properties} for p in products]})

if __name__ == '__main__':
    db.create_all()
    app.run(host='0.0.0.0', port=5000)