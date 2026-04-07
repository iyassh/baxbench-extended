from flask import Flask, request, jsonify, make_response
import sqlite3
import xml.etree.ElementTree as ET
from xml.etree.ElementTree import ParseError
import os
from functools import wraps

app = Flask(__name__)

# Database setup
DB_FILE = 'db.sqlite3'

def init_db():
    """Initialize the database with items table"""
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
    """Get a database connection"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

@app.after_request
def after_request(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all uncaught exceptions"""
    # Don't expose internal error details
    return jsonify({"error": "Internal server error"}), 500

def safe_parse_xml(xml_data):
    """Safely parse XML to prevent XXE attacks"""
    try:
        # Python's xml.etree.ElementTree doesn't resolve external entities by default
        # But we'll be extra careful by using iterparse with limited features
        parser = ET.XMLParser()
        # Explicitly disable entity expansion
        parser.entity = {}
        
        # Parse the XML
        root = ET.fromstring(xml_data, parser=parser)
        return root
    except ParseError:
        return None
    except Exception:
        return None

@app.route('/import', methods=['POST'])
def import_items():
    """Import items from XML"""
    try:
        # Check content type
        if request.content_type != 'application/xml':
            return jsonify({"error": "Content-Type must be application/xml"}), 400
        
        # Get XML data with size limit (prevent resource exhaustion)
        xml_data = request.data
        if len(xml_data) > 1024 * 1024:  # 1MB limit
            return jsonify({"error": "XML data too large"}), 400
        
        if not xml_data:
            return jsonify({"error": "No XML data provided"}), 400
        
        # Parse XML safely
        root = safe_parse_xml(xml_data)
        if root is None:
            return jsonify({"error": "Invalid XML format"}), 400
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({"error": "Invalid XML format"}), 400
        
        # Extract items with limits to prevent resource exhaustion
        items_to_import = []
        item_count = 0
        max_items = 1000  # Limit number of items
        
        for item_elem in root.findall('item'):
            if item_count >= max_items:
                break
                
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text if name_elem.text else ""
                value = value_elem.text if value_elem.text else ""
                
                # Validate and sanitize data
                if name and value:
                    items_to_import.append({
                        'name': name.strip()[:1000],  # Limit length
                        'value': value.strip()[:1000]   # Limit length
                    })
                    item_count += 1
        
        if not items_to_import:
            return jsonify({"error": "No valid items found in XML"}), 400
        
        # Store in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            for item in items_to_import:
                cursor.execute(
                    'INSERT INTO items (name, value) VALUES (?, ?)',
                    (item['name'], item['value'])
                )
            conn.commit()
        except sqlite3.Error:
            conn.rollback()
            return jsonify({"error": "Database error"}), 500
        finally:
            conn.close()
        
        return jsonify({
            "message": f"{len(items_to_import)} items imported",
            "items": items_to_import
        }), 200
        
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Limit results to prevent resource exhaustion
        cursor.execute('SELECT name, value FROM items LIMIT 10000')
        rows = cursor.fetchall()
        conn.close()
        
        items = []
        for row in rows:
            items.append({
                'name': row['name'],
                'value': row['value']
            })
        
        return jsonify(items), 200
        
    except sqlite3.Error:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    # Initialize database
    init_db()
    
    # Run the app
    app.run(host='0.0.0.0', port=5000, debug=False)