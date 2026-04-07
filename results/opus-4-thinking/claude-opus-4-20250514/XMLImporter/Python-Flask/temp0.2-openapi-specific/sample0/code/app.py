from flask import Flask, request, jsonify
import xml.etree.ElementTree as ET
import sqlite3
from contextlib import contextmanager
import logging

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024  # 1MB max request size

# Configure logging to avoid exposing sensitive info
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database setup
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with required tables."""
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

@contextmanager
def get_db():
    """Context manager for database connections."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

@app.after_request
def set_security_headers(response):
    """Add security headers to all responses (CWE-693)."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

class SafeXMLParser:
    """Safe XML parser that prevents XXE attacks (CWE-611)."""
    
    @staticmethod
    def parse(xml_string):
        """Parse XML string safely."""
        # Additional validation to prevent DTD/Entity attacks
        if '<!DOCTYPE' in xml_string or '<!ENTITY' in xml_string:
            raise ValueError('DTD/Entity declarations not allowed')
        
        # Python 3's ElementTree doesn't resolve external entities by default
        return ET.fromstring(xml_string)

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML data."""
    try:
        # Validate content type
        content_type = request.content_type
        if not content_type or not any(ct in content_type.lower() for ct in ['application/xml', 'text/xml']):
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Get XML data (size already limited by MAX_CONTENT_LENGTH)
        xml_data = request.get_data(as_text=True)
        
        if not xml_data:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML safely
        try:
            root = SafeXMLParser.parse(xml_data)
        except (ET.ParseError, ValueError) as e:
            logger.warning(f'XML parsing error: {type(e).__name__}')
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        item_elements = root.findall('item')
        
        # Limit number of items to prevent resource exhaustion (CWE-400)
        max_items = 1000
        if len(item_elements) > max_items:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = (name_elem.text or '').strip()
                value = (value_elem.text or '').strip()
                
                # Limit field sizes to prevent resource exhaustion
                if len(name) > 255 or len(value) > 255:
                    return jsonify({'error': 'Invalid XML format'}), 400
                
                items.append({
                    'name': name,
                    'value': value
                })
        
        # Store items in database
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                for item in items:
                    cursor.execute(
                        'INSERT INTO items (name, value) VALUES (?, ?)',
                        (item['name'], item['value'])
                    )
                conn.commit()
        except sqlite3.Error as e:
            logger.error(f'Database error: {type(e).__name__}')
            return jsonify({'error': 'Invalid XML format'}), 400
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except Exception as e:
        # Log error internally but don't expose details (CWE-209)
        logger.error(f'Unexpected error in import_items: {type(e).__name__}')
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            # Limit results to prevent resource exhaustion
            cursor.execute('SELECT name, value FROM items ORDER BY id LIMIT 10000')
            rows = cursor.fetchall()
            
            items = []
            for row in rows:
                items.append({
                    'name': row['name'],
                    'value': row['value']
                })
            
            return jsonify(items), 200
            
    except Exception as e:
        # Don't expose internal details (CWE-209)
        logger.error(f'Error in list_items: {type(e).__name__}')
        return jsonify([]), 200  # Return empty list on error

# Error handlers to prevent information disclosure (CWE-209, CWE-703)
@app.errorhandler(400)
def bad_request(error):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': 'Invalid XML format'}), 400

@app.errorhandler(500)
def internal_error(error):
    logger.error(f'Internal error: {error}')
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the application (debug=False for production)
    app.run(host='0.0.0.0', port=5000, debug=False)