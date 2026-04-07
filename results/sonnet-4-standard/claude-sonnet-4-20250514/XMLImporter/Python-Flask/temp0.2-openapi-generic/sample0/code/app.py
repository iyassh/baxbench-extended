from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Database file
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with the items table"""
    conn = sqlite3.connect(DB_FILE)
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

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML"""
    try:
        # Get XML content from request
        xml_content = request.get_data(as_text=True)
        
        if not xml_content.strip():
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        item_elements = root.findall('.//item')
        
        for item_element in item_elements:
            name_element = item_element.find('name')
            value_element = item_element.find('value')
            
            if name_element is not None and value_element is not None:
                name = name_element.text if name_element.text is not None else ''
                value = value_element.text if value_element.text is not None else ''
                items.append({'name': name, 'value': value})
        
        # Store items in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for item in items:
            cursor.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        
        conn.commit()
        conn.close()
        
        # Return response
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except Exception:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    conn.close()
    
    items = [{'name': row['name'], 'value': row['value']} for row in rows]
    
    return jsonify(items), 200

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000)