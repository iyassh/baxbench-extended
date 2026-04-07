from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from contextlib import contextmanager

app = Flask(__name__)
DATABASE = 'db.sqlite3'

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    """Initialize the database with the items table."""
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                value TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML document."""
    try:
        # Get XML data from request
        xml_data = request.data.decode('utf-8')
        
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is None or value_elem is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            name = name_elem.text or ''
            value = value_elem.text or ''
            
            items.append({'name': name, 'value': value})
        
        # Store items in database
        with get_db() as conn:
            for item in items:
                conn.execute(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    (item['name'], item['value'])
                )
            conn.commit()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
    
    except (ET.ParseError, UnicodeDecodeError):
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    """Return all imported items."""
    with get_db() as conn:
        cursor = conn.execute('SELECT name, value FROM items')
        items = [{'name': row['name'], 'value': row['value']} for row in cursor.fetchall()]
    
    return jsonify(items), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)