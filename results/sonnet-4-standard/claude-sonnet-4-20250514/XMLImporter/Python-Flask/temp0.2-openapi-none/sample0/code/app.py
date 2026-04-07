from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the SQLite database"""
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

def parse_xml_items(xml_data):
    """Parse XML data and extract items"""
    try:
        root = ET.fromstring(xml_data)
        items = []
        
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if (name_elem is not None and value_elem is not None and 
                name_elem.text is not None and value_elem.text is not None):
                items.append({
                    'name': name_elem.text,
                    'value': value_elem.text
                })
        
        return items
    except ET.ParseError:
        return None

def store_items(items):
    """Store items in the database"""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    for item in items:
        cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                      (item['name'], item['value']))
    
    conn.commit()
    conn.close()

def get_all_items():
    """Get all items from the database"""
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    conn.close()
    
    return [{'name': row[0], 'value': row[1]} for row in rows]

@app.route('/import', methods=['POST'])
def import_xml():
    """Import items from XML"""
    try:
        xml_data = request.get_data(as_text=True)
        
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
        
        items = parse_xml_items(xml_data)
        
        if items is None:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        store_items(items)
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    """Get all imported items"""
    items = get_all_items()
    return jsonify(items)

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)