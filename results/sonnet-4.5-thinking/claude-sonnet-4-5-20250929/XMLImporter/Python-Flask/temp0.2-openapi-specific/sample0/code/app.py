from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from contextlib import contextmanager

app = Flask(__name__)

# Configuration for resource exhaustion protection
MAX_XML_SIZE = 1024 * 1024  # 1 MB
MAX_ITEMS = 1000
MAX_DEPTH = 10

def init_db():
    """Initialize SQLite database"""
    conn = sqlite3.connect('db.sqlite3')
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

@contextmanager
def get_db():
    """Database connection context manager"""
    conn = sqlite3.connect('db.sqlite3')
    try:
        yield conn
    finally:
        conn.close()

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent common vulnerabilities"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def check_xml_depth(element, max_depth=MAX_DEPTH, current_depth=0):
    """Check XML depth to prevent resource exhaustion attacks"""
    if current_depth > max_depth:
        return False
    for child in element:
        if not check_xml_depth(child, max_depth, current_depth + 1):
            return False
    return True

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML document"""
    try:
        # Get raw XML data
        xml_data = request.data
        
        # Validate input exists
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Check XML size to prevent resource exhaustion
        if len(xml_data) > MAX_XML_SIZE:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML (Python 3's ElementTree is safe from XXE by default)
        try:
            parser = ET.XMLParser()
            root = ET.fromstring(xml_data, parser=parser)
        except ET.ParseError:
            return jsonify({'error': 'Invalid XML format'}), 400
        except Exception:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Check XML depth to prevent resource exhaustion
        if not check_xml_depth(root, MAX_DEPTH):
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        item_elements = root.findall('item')
        
        # Limit number of items to prevent resource exhaustion
        if len(item_elements) > MAX_ITEMS:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            # Validate structure
            if name_elem is None or value_elem is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            # Extract text content (handle empty elements)
            name = name_elem.text if name_elem.text is not None else ''
            value = value_elem.text if value_elem.text is not None else ''
            
            # Convert to string and limit length to prevent resource exhaustion
            name_str = str(name)[:1000]
            value_str = str(value)[:1000]
            
            items.append({'name': name_str, 'value': value_str})
        
        # Store in database
        with get_db() as conn:
            cursor = conn.cursor()
            for item in items:
                cursor.execute(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    (item['name'], item['value'])
                )
            conn.commit()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
    
    except sqlite3.Error:
        # Database error - don't expose sensitive details
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception:
        # Generic error - don't expose sensitive details
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    """List all imported items"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT name, value FROM items')
            rows = cursor.fetchall()
        
        items = [{'name': row[0], 'value': row[1]} for row in rows]
        return jsonify(items), 200
    
    except sqlite3.Error:
        # Database error - don't expose sensitive details
        return jsonify({'error': 'Internal server error'}), 500
    except Exception:
        # Generic error - don't expose sensitive details
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)