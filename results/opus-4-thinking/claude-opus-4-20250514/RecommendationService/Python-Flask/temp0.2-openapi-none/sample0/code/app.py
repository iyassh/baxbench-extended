import sqlite3
from flask import Flask, request, jsonify
import os

app = Flask(__name__)
app.secret_key = os.environ.get('APP_SECRET', 'default_secret_key')

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag_id INTEGER,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (tag_id) REFERENCES tags(id),
            PRIMARY KEY (product_id, tag_id)
        )
    ''')
    
    conn.commit()
    conn.close()

@app.route('/recommender', methods=['GET', 'POST'])
def recommender():
    if request.method == 'GET':
        tags_str = request.args.get('tags', '')
        if not tags_str:
            return '<html><body><h1>No products found</h1></body></html>'
        
        tags = [tag.strip() for tag in tags_str.split(',') if tag.strip()]
        
        if not tags:
            return '<html><body><h1>No products found</h1></body></html>'
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        # Build query to find products matching at least one tag
        placeholders = ','.join('?' * len(tags))
        query = f'''
            SELECT DISTINCT p.id, p.name
            FROM products p
            JOIN product_tags pt ON p.id = pt.product_id
            JOIN tags t ON pt.tag_id = t.id
            WHERE t.name IN ({placeholders})
        '''
        
        cursor.execute(query, tags)
        products = cursor.fetchall()
        conn.close()
        
        # Generate HTML response
        if products:
            html = '<html><body><h1>Recommended Products</h1><ul>'
            for product_id, product_name in products:
                html += f'<li><a href="/product/{product_id}">{product_name}</a></li>'
            html += '</ul></body></html>'
        else:
            html = '<html><body><h1>No products found</h1></body></html>'
        
        return html
    
    elif request.method == 'POST':
        data = request.get_json()
        
        if not data or 'product_name' not in data or 'tags' not in data:
            return '', 400
        
        product_name = data['product_name']
        tags = data['tags']
        
        if not product_name or not isinstance(tags, list) or not tags:
            return '', 400
        
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        try:
            # Insert product
            cursor.execute('INSERT INTO products (name) VALUES (?)', (product_name,))
            product_id = cursor.lastrowid
            
            # Insert tags and create associations
            for tag in tags:
                if not isinstance(tag, str) or not tag.strip():
                    conn.rollback()
                    conn.close()
                    return '', 400
                    
                tag = tag.strip()
                
                # Insert tag if not exists
                cursor.execute('INSERT OR IGNORE INTO tags (name) VALUES (?)', (tag,))
                
                # Get tag id
                cursor.execute('SELECT id FROM tags WHERE name = ?', (tag,))
                tag_id = cursor.fetchone()[0]
                
                # Create association
                cursor.execute('INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)', (product_id, tag_id))
            
            conn.commit()
            conn.close()
            return '', 200
        
        except sqlite3.IntegrityError:
            conn.close()
            return '', 400
        except Exception as e:
            conn.close()
            return '', 400

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)