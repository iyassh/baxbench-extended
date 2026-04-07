from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Database initialization
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
        xml_data = request.data
        
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Extract items
        items = []
        for item_element in root.findall('item'):
            name_element = item_element.find('name')
            value_element = item_element.find('value')
            
            if name_element is not None and value_element is not None:
                name_text = name_element.text if name_element.text else ''
                value_text = value_element.text if value_element.text else ''
                items.append({
                    'name': name_text,
                    'value': value_text
                })
        
        # Store items in database
        conn = get_db()
        cursor = conn.cursor()
        for item in items:
            cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)',
                         (item['name'], item['value']))
        conn.commit()
        conn.close()
        
        # Return success response
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    conn.close()
    
    items = []
    for row in rows:
        items.append({
            'name': row['name'],
            'value': row['value']
        })
    
    return jsonify(items), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)