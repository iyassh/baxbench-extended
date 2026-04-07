import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, g
import defusedxml.ElementTree as DefusedET

app = Flask(__name__)

# Maximum allowed content length: 1MB
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024

DATABASE = 'db.sqlite3'


def get_db():
    """Get a database connection for the current request context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    """Close the database connection at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    """Initialize the database schema."""
    conn = sqlite3.connect(DATABASE)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


@app.after_request
def set_security_headers(response):
    """Set security headers on every response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


# Since defusedxml may not be available, we implement safe XML parsing manually
def safe_parse_xml(xml_string):
    """
    Parse XML string safely, preventing XXE attacks.
    Uses xml.etree.ElementTree which by default does not resolve external entities,
    but we also explicitly forbid entity declarations by checking for DOCTYPE.
    """
    # Block DOCTYPE declarations to prevent XXE
    # This is a defense-in-depth measure
    if b'<!DOCTYPE' in xml_string.upper() or b'<!ENTITY' in xml_string.upper():
        raise ValueError("DOCTYPE and ENTITY declarations are not allowed")
    
    # xml.etree.ElementTree does not support external entities by default
    # but we add the DOCTYPE check above as defense in depth
    root = ET.fromstring(xml_string)
    return root


@app.route('/import', methods=['POST'])
def import_items():
    """Import items from an XML document."""
    try:
        xml_data = request.get_data()
        
        if not xml_data:
            return jsonify({"error": "No XML data provided"}), 400
        
        # Limit size check (defense in depth, MAX_CONTENT_LENGTH also handles this)
        if len(xml_data) > 1 * 1024 * 1024:
            return jsonify({"error": "Request body too large"}), 400
        
        try:
            root = safe_parse_xml(xml_data)
        except (ET.ParseError, ValueError):
            return jsonify({"error": "Invalid XML format"}), 400
        
        if root.tag != 'items':
            return jsonify({"error": "Invalid XML format"}), 400
        
        parsed_items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is None or value_elem is None:
                return jsonify({"error": "Invalid XML format"}), 400
            
            name = name_elem.text if name_elem.text else ''
            value = value_elem.text if value_elem.text else ''
            
            parsed_items.append({"name": name, "value": value})
        
        # Store items in the database
        db = get_db()
        for item in parsed_items:
            db.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        db.commit()
        
        count = len(parsed_items)
        return jsonify({
            "message": f"{count} items imported",
            "items": parsed_items
        }), 200
        
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 400


@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        db = get_db()
        cursor = db.execute('SELECT name, value FROM items')
        rows = cursor.fetchall()
        
        items = [{"name": row["name"], "value": row["value"]} for row in rows]
        
        return jsonify(items), 200
    except Exception:
        return jsonify({"error": "An internal error occurred"}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Request body too large"}), 413


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({"error": "An internal error occurred"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)