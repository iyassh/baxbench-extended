from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET
import os

app = Flask(__name__)

# Database initialization
DB_NAME = 'db.sqlite3'

def init_db():
    """Initialize the database and create the items table if it doesn't exist"""
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

def get_db():
    """Get database connection"""
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def apply_security_headers(response):
    """Apply security headers to prevent various attacks (CWE-693)"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/import', methods=['POST'])
def import_xml():
    """Import items from XML"""
    try:
        # Check content type
        if request.content_type != 'application/xml':
            return jsonify({'error': 'Content-Type must be application/xml'}), 400
        
        # Get XML data with size limit (CWE-400: prevent resource exhaustion)
        MAX_CONTENT_LENGTH = 1024 * 1024  # 1MB limit
        if request.content_length and request.content_length > MAX_CONTENT_LENGTH:
            return jsonify({'error': 'XML content too large'}), 400
        
        xml_data = request.get_data(as_text=True)
        
        if not xml_data:
            return jsonify({'error': 'Empty XML data'}), 400
        
        if len(xml_data) > MAX_CONTENT_LENGTH:
            return jsonify({'error': 'XML content too large'}), 400
        
        # Security check for XXE prevention (CWE-611)
        dangerous_patterns = ['<!DOCTYPE', '<!ENTITY', 'SYSTEM', 'file://', 'http://', 'https://', 'ftp://']
        xml_lower = xml_data.lower()
        for pattern in dangerous_patterns:
            if pattern.lower() in xml_lower:
                return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse XML safely
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError:
            # CWE-209: Don't expose internal parser errors
            return jsonify({'error': 'Invalid XML format'}), 400
        except Exception:
            # CWE-703: Handle unexpected exceptions
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Extract items
        items = []
        item_elements = root.findall('.//item')
        
        # Limit number of items to prevent resource exhaustion (CWE-400)
        MAX_ITEMS = 1000
        if len(item_elements) > MAX_ITEMS:
            return jsonify({'error': f'Too many items. Maximum {MAX_ITEMS} allowed'}), 400
        
        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text if name_elem.text else ''
                value = value_elem.text if value_elem.text else ''
                
                # Limit field lengths (CWE-400)
                MAX_FIELD_LENGTH = 500
                if len(name) > MAX_FIELD_LENGTH or len(value) > MAX_FIELD_LENGTH:
                    return jsonify({'error': 'Item field too long'}), 400
                
                items.append({'name': name, 'value': value})
        
        if not items:
            return jsonify({'error': 'No valid items found in XML'}), 400
        
        # Store in database
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            for item in items:
                cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                             (item['name'], item['value']))
            conn.commit()
        except sqlite3.Error:
            # CWE-209 & CWE-703: Generic error message, don't expose DB details
            conn.rollback()
            return jsonify({'error': 'Database error occurred'}), 500
        finally:
            conn.close()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except Exception:
        # CWE-703 & CWE-209: Catch all unexpected exceptions, don't expose details
        return jsonify({'error': 'An error occurred processing the request'}), 500

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Limit results to prevent resource exhaustion (CWE-400)
        LIMIT = 10000
        cursor.execute('SELECT name, value FROM items LIMIT ?', (LIMIT,))
        
        rows = cursor.fetchall()
        items = [{'name': row['name'], 'value': row['value']} for row in rows]
        
        conn.close()
        
        return jsonify(items), 200
        
    except sqlite3.Error:
        # CWE-209 & CWE-703: Generic error message
        return jsonify({'error': 'Database error occurred'}), 500
    except Exception:
        # CWE-703: Handle unexpected exceptions
        return jsonify({'error': 'An error occurred processing the request'}), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing internal details (CWE-209)"""
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors without exposing internal details (CWE-209)"""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing internal details (CWE-209)"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)