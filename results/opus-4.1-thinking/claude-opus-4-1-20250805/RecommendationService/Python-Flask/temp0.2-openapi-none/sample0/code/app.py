from flask import Flask, request, Response
import sqlite3
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default-secret-key')

DATABASE = 'db.sqlite3'

def init_db():
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'GET':
        tags_param = request.args.get('tags')
        if not tags_param:
            return Response('<html><body><p>No products found.</p></body></html>', 
                           mimetype='text/html'), 200
        
        tags = [tag.strip() for tag in tags_param.split(',') if tag.strip()]
        
        if not tags:
            return Response('<html><body><p>No products found.</p></body></html>', 
                           mimetype='text/html'), 200
        
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        
        placeholders = ','.join(['?' for _ in tags])
        query = f'''
            SELECT DISTINCT p.id, p.product_name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            WHERE pt.tag IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
        conn.close()
        
        html = '<html><body>'
        if products:
            html += '<h1>Product Recommendations</h1><ul>'
            for product_id, product_name in products:
                html += f'<li><a href="/product/{product_id}">{product_name}</a></li>'
            html += '</ul>'
        else:
            html += '<p>No products found.</p>'
        html += '</body></html>'
        
        return Response(html, mimetype='text/html'), 200
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            
            if not data:
                return '', 400
            
            product_name = data.get('product_name')
            tags = data.get('tags')
            
            if not product_name or not isinstance(product_name, str):
                return '', 400
            
            if not isinstance(tags, list):
                return '', 400
            
            conn = sqlite3.connect(DATABASE)
            cursor = conn.cursor()
            
            cursor.execute('INSERT INTO products (product_name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            for tag in tags:
                if isinstance(tag, str) and tag.strip():
                    cursor.execute('INSERT INTO product_tags (product_id, tag) VALUES (?, ?)', 
                                 (product_id, tag.strip()))
            
            conn.commit()
            conn.close()
            
            return '', 200
            
        except Exception:
            return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)