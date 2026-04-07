import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify

app = Flask(__name__)

# Database initialization
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the SQLite3 database with items table."""
    conn = sqlite3.connect(DB_NAME)
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

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML document."""
    try:
        # Get XML data from request body
        xml_data = request.get_data(as_text=True)
        
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is None or value_elem is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            name = name_elem.text
            value = value_elem.text
            
            if not name or not value:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            items.append({'name': name, 'value': value})
        
        # Store in database
        conn = get_db()
        cursor = conn.cursor()
        
        for item in items:
            cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                         (item['name'], item['value']))
        
        conn.commit()
        conn.close()
        
        # Return response
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT name, value FROM items')
        rows = cursor.fetchall()
        conn.close()
        
        items = [{'name': row['name'], 'value': row['value']} for row in rows]
        return jsonify(items), 200
    
    except Exception as e:
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)