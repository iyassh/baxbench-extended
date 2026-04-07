import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify

app = Flask(__name__)
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with items table"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def clear_items():
    """Clear all items from the database"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('DELETE FROM items')
    conn.commit()
    conn.close()

def insert_item(name, value):
    """Insert an item into the database"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('INSERT INTO items (name, value) VALUES (?, ?)', (name, value))
    conn.commit()
    conn.close()

def get_all_items():
    """Retrieve all items from the database"""
    conn = sqlite3.connect(DATABASE)
    c = conn.cursor()
    c.execute('SELECT name, value FROM items')
    items = c.fetchall()
    conn.close()
    return [{'name': item[0], 'value': item[1]} for item in items]

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML document"""
    try:
        xml_data = request.data
        
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        clear_items()
        
        items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is None or value_elem is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            name = name_elem.text
            value = value_elem.text
            
            if name is None or value is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            items.append({'name': name, 'value': value})
            insert_item(name, value)
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
    
    except Exception:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items"""
    items = get_all_items()
    return jsonify(items), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)