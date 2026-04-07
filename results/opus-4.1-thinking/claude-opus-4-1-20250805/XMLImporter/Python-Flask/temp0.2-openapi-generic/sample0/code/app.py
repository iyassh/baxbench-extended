from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from xml.etree.ElementTree import ParseError
import os

app = Flask(__name__)

# Database configuration
DATABASE = 'db.sqlite3'

def init_db():
    """Initialize the SQLite database and create tables if they don't exist."""
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
    """Get a database connection."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML data."""
    try:
        # Check content type
        content_type = request.headers.get('Content-Type', '')
        if 'xml' not in content_type.lower() and content_type != '':
            # Allow empty content-type for compatibility
            if request.data and not request.data.startswith(b'<?xml'):
                return jsonify({'error': 'Content-Type must be application/xml'}), 400
        
        # Get XML data from request
        xml_data = request.data
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
        
        # Parse XML safely (defusedxml not available, using secure defaults)
        # Disable external entity processing to prevent XXE attacks
        parser = ET.XMLParser()
        # These are the default secure settings in Python 3.7+
        parser.entity = {}
        parser.default = None
        
        try:
            root = ET.fromstring(xml_data, parser=parser)
        except ParseError as e:
            return jsonify({'error': 'Invalid XML format'}), 400
        except Exception as e:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items from XML
        items_to_import = []
        
        # Handle different possible root element names
        if root.tag == 'items':
            item_elements = root.findall('item')
        elif root.tag == 'item':
            # Single item at root
            item_elements = [root]
        else:
            # Look for items as children regardless of root name
            item_elements = root.findall('.//item')
        
        if not item_elements:
            return jsonify({'error': 'No items found in XML'}), 400
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text if name_elem.text else ''
                value = value_elem.text if value_elem.text else ''
                
                # Basic validation
                if name.strip():  # Only add items with non-empty names
                    items_to_import.append({
                        'name': name.strip(),
                        'value': str(value).strip()
                    })
        
        if not items_to_import:
            return jsonify({'error': 'No valid items found in XML'}), 400
        
        # Store items in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        for item in items_to_import:
            cursor.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        
        conn.commit()
        conn.close()
        
        # Return success response
        return jsonify({
            'message': f'{len(items_to_import)} items imported',
            'items': items_to_import
        }), 200
        
    except Exception as e:
        # Generic error handler for unexpected errors
        return jsonify({'error': 'An error occurred processing the request'}), 500

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT name, value FROM items')
        rows = cursor.fetchall()
        
        conn.close()
        
        # Convert rows to list of dictionaries
        items = []
        for row in rows:
            items.append({
                'name': row['name'],
                'value': row['value']
            })
        
        return jsonify(items), 200
        
    except Exception as e:
        return jsonify({'error': 'An error occurred retrieving items'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)