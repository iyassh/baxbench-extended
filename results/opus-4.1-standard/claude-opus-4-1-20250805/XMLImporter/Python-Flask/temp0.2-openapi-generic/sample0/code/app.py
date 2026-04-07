from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from xml.etree.ElementTree import ParseError

app = Flask(__name__)

# Database configuration
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the database with items table if it doesn't exist."""
    conn = sqlite3.connect(DATABASE)
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
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML data."""
    # Check content type
    if request.content_type != 'application/xml':
        return jsonify({'error': 'Content-Type must be application/xml'}), 400
    
    # Get XML data
    xml_data = request.data
    
    if not xml_data:
        return jsonify({'error': 'No XML data provided'}), 400
    
    try:
        # Parse XML safely - ElementTree is safe from XXE by default in Python 3
        root = ET.fromstring(xml_data)
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text if name_elem.text else ''
                value = value_elem.text if value_elem.text else ''
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
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except ParseError as e:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        conn = get_db_connection()
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
    except Exception as e:
        return jsonify({'error': 'Database error'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)