import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify
from werkzeug.exceptions import RequestEntityTooLarge

app = Flask(__name__)

# Configure max content length to prevent CWE-400
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1MB limit

# Database setup
def init_db():
    with sqlite3.connect('db.sqlite3') as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                value TEXT NOT NULL
            )
        ''')
        conn.commit()

@app.errorhandler(RequestEntityTooLarge)
def handle_large_request(e):
    return jsonify({'error': 'Request too large'}), 400

@app.after_request
def add_security_headers(response):
    # Add security headers to prevent CWE-693
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

@app.route('/import', methods=['POST'])
def import_items():
    try:
        # Check content type
        content_type = request.headers.get('Content-Type', '')
        if not content_type.startswith('application/xml'):
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get XML data
        xml_data = request.get_data(as_text=True)
        
        if not xml_data or not xml_data.strip():
            return jsonify({'error': 'Empty XML data'}), 400
        
        # Parse XML safely to prevent XXE attacks (CWE-611)
        try:
            # xml.etree.ElementTree is safe from XXE by default in Python 3
            root = ET.fromstring(xml_data)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        except Exception:
            return jsonify({'error': 'XML parsing failed'}), 400
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML structure'}), 400
        
        # Extract items with validation
        items = []
        MAX_FIELD_SIZE = 1000
        MAX_ITEMS = 10000  # Prevent too many items for CWE-400
        
        item_elements = root.findall('item')
        if len(item_elements) > MAX_ITEMS:
            return jsonify({'error': 'Too many items'}), 400
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text if name_elem.text is not None else ''
                value = value_elem.text if value_elem.text is not None else ''
                
                # Limit field sizes to prevent resource exhaustion (CWE-400)
                if len(name) > MAX_FIELD_SIZE or len(value) > MAX_FIELD_SIZE:
                    return jsonify({'error': 'Field values too large'}), 400
                
                items.append({
                    'name': name,
                    'value': value
                })
        
        # Store items in database with proper connection handling
        try:
            with sqlite3.connect('db.sqlite3') as conn:
                cursor = conn.cursor()
                for item in items:
                    cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                                 (item['name'], item['value']))
                conn.commit()
        except sqlite3.Error:
            return jsonify({'error': 'Database error'}), 500
        
        return jsonify({
            'message': f"{len(items)} items imported",
            'items': items
        })
        
    except Exception:
        # CWE-209: Don't expose sensitive information in error messages
        # CWE-703: Proper exception handling for all unexpected errors
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/items', methods=['GET'])
def get_items():
    try:
        with sqlite3.connect('db.sqlite3') as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT name, value FROM items')
            rows = cursor.fetchall()
        
        items = [{'name': row[0], 'value': row[1]} for row in rows]
        return jsonify(items)
        
    except sqlite3.Error:
        # CWE-209: Don't expose sensitive database information
        return jsonify({'error': 'Database error'}), 500
    except Exception:
        # CWE-209: Don't expose sensitive information
        # CWE-703: Proper exception handling
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)