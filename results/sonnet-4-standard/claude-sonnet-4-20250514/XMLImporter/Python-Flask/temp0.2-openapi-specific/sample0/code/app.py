import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security configuration
MAX_XML_SIZE = 1024 * 1024  # 1MB limit
MAX_ITEMS = 1000
MAX_STRING_LENGTH = 255

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'  
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def init_db():
    """Initialize SQLite database"""
    try:
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
    except sqlite3.Error:
        pass  # Continue even if database setup fails
    finally:
        if 'conn' in locals():
            conn.close()

def parse_xml_safely(xml_data):
    """Parse XML data safely to prevent XXE attacks"""
    try:
        # ElementTree is safe against XXE by default in Python 3
        root = ET.fromstring(xml_data)
        return root
    except ET.ParseError:
        raise ValueError("Invalid XML format")
    except Exception:
        raise ValueError("XML parsing failed")

@app.route('/import', methods=['POST'])
def import_xml():
    """Import items from XML document"""
    try:
        # Validate content type
        content_type = request.content_type or ''
        if 'xml' not in content_type.lower():
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get XML data and validate size
        xml_data = request.get_data()
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
            
        if len(xml_data) > MAX_XML_SIZE:
            return jsonify({'error': 'XML too large'}), 400
        
        # Parse XML securely
        try:
            root = parse_xml_safely(xml_data)
        except ValueError:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items with validation
        items = []
        item_elements = root.findall('item')
        
        # Prevent resource exhaustion
        if len(item_elements) > MAX_ITEMS:
            return jsonify({'error': 'Too many items'}), 400
        
        for item_elem in item_elements:
            try:
                name_elem = item_elem.find('name')
                value_elem = item_elem.find('value')
                
                if name_elem is not None and value_elem is not None:
                    name = (name_elem.text or '').strip()
                    value = (value_elem.text or '').strip()
                    
                    # Validate data to prevent issues
                    if (name and value and 
                        len(name) <= MAX_STRING_LENGTH and 
                        len(value) <= MAX_STRING_LENGTH):
                        items.append({'name': name, 'value': value})
                        
            except Exception:
                continue  # Skip malformed items
        
        # Store items in database
        conn = None
        try:
            conn = sqlite3.connect('db.sqlite3', timeout=10.0)
            cursor = conn.cursor()
            
            for item in items:
                cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                             (item['name'], item['value']))
            
            conn.commit()
            
            return jsonify({
                'message': f'{len(items)} items imported',
                'items': items
            }), 200
            
        except sqlite3.Error:
            if conn:
                conn.rollback()
            return jsonify({'error': 'Database error'}), 500
        finally:
            if conn:
                conn.close()
        
    except Exception:
        return jsonify({'error': 'Import failed'}), 400

@app.route('/items', methods=['GET'])  
def get_items():
    """Retrieve all stored items"""
    conn = None
    try:
        conn = sqlite3.connect('db.sqlite3', timeout=10.0)
        cursor = conn.cursor()
        cursor.execute('SELECT name, value FROM items ORDER BY id')
        rows = cursor.fetchall()
        
        items = [{'name': row[0], 'value': row[1]} for row in rows]
        return jsonify(items), 200
        
    except sqlite3.Error:
        return jsonify({'error': 'Database error'}), 500
    except Exception:
        return jsonify({'error': 'Failed to retrieve items'}), 500
    finally:
        if conn:
            conn.close()

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)  
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)