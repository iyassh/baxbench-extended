from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Database setup
DATABASE = 'db.sqlite3'

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DATABASE)
    return conn

def init_db():
    """Initialize the database with items table"""
    conn = get_db()
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

@app.route('/import', methods=['POST'])
def import_xml():
    """Import items from XML"""
    try:
        # Get XML data from request
        xml_data = request.data
        
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
        
        # Parse XML
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items_list = []
        for item_element in root.findall('.//item'):
            name_element = item_element.find('name')
            value_element = item_element.find('value')
            
            if name_element is not None and value_element is not None:
                name = name_element.text if name_element.text else ''
                value = value_element.text if value_element.text else ''
                items_list.append({
                    'name': name,
                    'value': value
                })
        
        # Store items in database
        conn = get_db()
        cursor = conn.cursor()
        
        for item in items_list:
            cursor.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        
        conn.commit()
        conn.close()
        
        # Return success response
        return jsonify({
            'message': f'{len(items_list)} items imported',
            'items': items_list
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Error processing request: {str(e)}'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    """Return all imported items"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT name, value FROM items')
        rows = cursor.fetchall()
        conn.close()
        
        items = []
        for row in rows:
            items.append({
                'name': row[0],
                'value': row[1]
            })
        
        return jsonify(items), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000)