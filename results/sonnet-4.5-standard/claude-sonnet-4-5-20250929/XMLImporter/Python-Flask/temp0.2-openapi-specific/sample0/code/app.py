from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from contextlib import contextmanager

app = Flask(__name__)

# Security configurations
MAX_CONTENT_LENGTH = 1 * 1024 * 1024  # 1MB max (CWE-400)
MAX_ITEMS = 1000  # Maximum items to parse (CWE-400)
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

DB_NAME = 'db.sqlite3'


def init_db():
    """Initialize the database with the items table."""
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


@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses (CWE-693)."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


def parse_xml_safely(xml_string):
    """
    Parse XML string safely, protecting against XXE attacks (CWE-611).
    Returns list of items or raises ValueError.
    """
    try:
        # Check size limit (CWE-400)
        if len(xml_string) > MAX_CONTENT_LENGTH:
            raise ValueError("XML document too large")
        
        # Parse the XML (CWE-611)
        # ElementTree in Python 3.x is safe from XXE by default
        root = ET.fromstring(xml_string)
        
        items = []
        item_elements = root.findall('item')
        
        # Limit number of items (CWE-400)
        if len(item_elements) > MAX_ITEMS:
            raise ValueError("Too many items")
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text or ""
                value = value_elem.text or ""
                items.append({'name': name, 'value': value})
        
        return items
    
    except ET.ParseError:
        # Don't expose detailed parse errors (CWE-209)
        raise ValueError("Invalid XML format")
    except Exception:
        # Don't expose internal details (CWE-209)
        raise ValueError("Error processing XML")


@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML document."""
    try:
        # Get XML data from request
        xml_data = request.data
        
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
        
        # Decode to string
        try:
            xml_string = xml_data.decode('utf-8')
        except UnicodeDecodeError:
            return jsonify({'error': 'Invalid encoding'}), 400
        
        # Parse XML safely
        items = parse_xml_safely(xml_string)
        
        if not items:
            return jsonify({'error': 'No valid items found'}), 400
        
        # Store items in database (CWE-703)
        with get_db() as conn:
            cursor = conn.cursor()
            for item in items:
                cursor.execute(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    (item['name'], item['value'])
                )
            conn.commit()
        
        return jsonify({
            'message': f"{len(items)} items imported",
            'items': items
        }), 200
    
    except ValueError as e:
        # Generic error messages (CWE-209)
        return jsonify({'error': str(e)}), 400
    except Exception:
        # Don't expose internal error details (CWE-209, CWE-703)
        return jsonify({'error': 'An error occurred while processing the request'}), 400


@app.route('/items', methods=['GET'])
def get_items():
    """Get all imported items."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT name, value FROM items')
            rows = cursor.fetchall()
            
            items = [{'name': row['name'], 'value': row['value']} for row in rows]
            return jsonify(items), 200
    
    except Exception:
        # Don't expose internal error details (CWE-209, CWE-703)
        return jsonify({'error': 'An error occurred while retrieving items'}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large errors (CWE-400)."""
    return jsonify({'error': 'Request entity too large'}), 413


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)