from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from xml.etree.ElementTree import ParseError

app = Flask(__name__)

# Database file
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with the required table."""
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
    """Create a database connection."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def parse_xml_safely(xml_string):
    """Parse XML string safely."""
    # Check for DOCTYPE declaration (potential XXE)
    if '<!DOCTYPE' in xml_string.upper():
        raise ValueError("DOCTYPE declarations are not allowed")
    
    # Check for entity declarations
    if '<!ENTITY' in xml_string.upper():
        raise ValueError("Entity declarations are not allowed")
    
    # Parse the XML
    try:
        root = ET.fromstring(xml_string)
        return root
    except ParseError:
        raise ValueError("Invalid XML format")

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML data."""
    try:
        # Get the XML data from the request
        xml_data = request.data.decode('utf-8')
        
        # Parse the XML safely
        root = parse_xml_safely(xml_data)
        
        # Check if root element is 'items'
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        imported_items = []
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for item in root.findall('item'):
            name_elem = item.find('name')
            value_elem = item.find('value')
            
            if name_elem is None or value_elem is None:
                continue
            
            name = name_elem.text
            value = value_elem.text
            
            if name is None or value is None:
                continue
            
            # Store in database
            cursor.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (str(name), str(value))
            )
            
            imported_items.append({
                'name': str(name),
                'value': str(value)
            })
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': f'{len(imported_items)} items imported',
            'items': imported_items
        }), 200
        
    except (ValueError, ParseError):
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """Return all imported items."""
    conn = get_db_connection()
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
    # Initialize the database
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)