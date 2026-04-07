from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
from xml.etree.ElementTree import ParseError

app = Flask(__name__)

# Database initialization
def init_db():
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

# Helper function to get db connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def add_security_headers(response):
    # Add security headers to prevent common vulnerabilities (CWE-693)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

def parse_xml_safely(xml_data):
    """Parse XML safely, preventing XXE attacks (CWE-611)"""
    # Create parser that doesn't resolve external entities
    parser = ET.XMLParser()
    # Disable DOCTYPE processing to prevent XXE
    parser.feed = lambda data: None
    parser = ET.XMLParser()
    
    # ElementTree in Python 3.7+ is safe by default against XXE
    # But we'll add extra validation
    try:
        # Check for dangerous patterns
        xml_str = xml_data.decode('utf-8') if isinstance(xml_data, bytes) else xml_data
        if '<!DOCTYPE' in xml_str or '<!ENTITY' in xml_str or 'SYSTEM' in xml_str:
            return None
        
        # Parse the XML
        root = ET.fromstring(xml_data)
        return root
    except Exception:
        return None

@app.route('/import', methods=['POST'])
def import_xml():
    try:
        # Check content type
        content_type = request.content_type
        if not content_type or not content_type.startswith('application/xml'):
            return jsonify({'error': 'Invalid content type'}), 400
        
        # Get XML data
        xml_data = request.data
        
        if not xml_data:
            return jsonify({'error': 'No XML data provided'}), 400
        
        # Check for reasonable size limit to prevent resource exhaustion (CWE-400)
        max_size = 10 * 1024 * 1024  # 10 MB limit
        if len(xml_data) > max_size:
            return jsonify({'error': 'XML data too large'}), 400
        
        # Parse XML safely (CWE-611)
        root = parse_xml_safely(xml_data)
        if root is None:
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        item_elements = root.findall('item')
        
        # Limit number of items to prevent resource exhaustion (CWE-400)
        max_items = 1000
        if len(item_elements) > max_items:
            return jsonify({'error': 'Too many items'}), 400
        
        for item_element in item_elements:
            name_elem = item_element.find('name')
            value_elem = item_element.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = str(name_elem.text) if name_elem.text is not None else ''
                value = str(value_elem.text) if value_elem.text is not None else ''
                
                # Limit field sizes (CWE-400)
                if len(name) > 1000 or len(value) > 1000:
                    return jsonify({'error': 'Field too large'}), 400
                
                items.append({'name': name, 'value': value})
        
        if not items:
            return jsonify({
                'message': '0 items imported',
                'items': []
            }), 200
        
        # Store in database with proper error handling (CWE-703)
        conn = None
        try:
            conn = get_db()
            cursor = conn.cursor()
            
            for item in items:
                cursor.execute(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    (item['name'], item['value'])
                )
            conn.commit()
        except sqlite3.IntegrityError:
            if conn:
                conn.rollback()
            # Don't expose database schema (CWE-209)
            return jsonify({'error': 'Data integrity error'}), 400
        except sqlite3.Error:
            if conn:
                conn.rollback()
            # Don't expose database errors (CWE-209)
            return jsonify({'error': 'Database error'}), 500
        finally:
            if conn:
                conn.close()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except MemoryError:
        # Handle memory exhaustion (CWE-400, CWE-703)
        return jsonify({'error': 'Request too large'}), 400
    except Exception:
        # Generic error handling without leaking details (CWE-209, CWE-703)
        return jsonify({'error': 'Server error'}), 500

@app.route('/items', methods=['GET'])
def list_items():
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Fetch all items with a reasonable limit to prevent resource exhaustion
        cursor.execute('SELECT name, value FROM items LIMIT 10000')
        rows = cursor.fetchall()
        
        items = []
        for row in rows:
            items.append({
                'name': row['name'],
                'value': row['value']
            })
        
        return jsonify(items), 200
        
    except sqlite3.Error:
        # Don't expose database errors (CWE-209, CWE-703)
        return jsonify({'error': 'Database error'}), 500
    except MemoryError:
        # Handle memory issues (CWE-400, CWE-703)
        return jsonify({'error': 'Too many items'}), 500
    except Exception:
        # Generic error handling (CWE-703)
        return jsonify({'error': 'Server error'}), 500
    finally:
        if conn:
            conn.close()

@app.errorhandler(404)
def not_found(error):
    # Don't leak information about non-existent routes (CWE-209)
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    # Don't leak information about allowed methods (CWE-209)
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    # Don't leak internal error details (CWE-209)
    return jsonify({'error': 'Server error'}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the Flask app
    # debug=False for production to prevent information leakage (CWE-209)
    app.run(host='0.0.0.0', port=5000, debug=False)