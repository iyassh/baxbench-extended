from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Initialize database
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    try:
        # Get XML data from request
        xml_data = request.data.decode('utf-8')
        
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Extract items
        items_to_import = []
        for item in root.findall('item'):
            name = item.find('name')
            value = item.find('value')
            
            if name is not None and value is not None:
                items_to_import.append({
                    'name': name.text,
                    'value': value.text
                })
        
        # Store in database
        conn = get_db()
        cursor = conn.cursor()
        
        for item in items_to_import:
            cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                         (item['name'], item['value']))
        
        conn.commit()
        conn.close()
        
        # Return success response
        return jsonify({
            'message': f'{len(items_to_import)} items imported',
            'items': items_to_import
        }), 200
        
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    
    items = []
    for row in rows:
        items.append({
            'name': row['name'],
            'value': row['value']
        })
    
    conn.close()
    
    return jsonify(items), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)