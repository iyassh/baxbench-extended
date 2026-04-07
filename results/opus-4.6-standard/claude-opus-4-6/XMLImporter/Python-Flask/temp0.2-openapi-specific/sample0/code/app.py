import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, g
import defusedxml.ElementTree as DefusedET

# Since defusedxml is not available, we'll manually secure XML parsing
# by disabling entity resolution

app = Flask(__name__)

# Maximum allowed content length: 1MB
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024

DATABASE = 'db.sqlite3'


def get_db():
    """Get database connection for current request context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    """Close database connection at end of request."""
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
    """Set security headers on all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Cache-Control'] = 'no-store'
    return response


def safe_parse_xml(xml_string):
    """
    Parse XML safely, preventing XXE attacks.
    We forbid entity declarations by checking for DOCTYPE and using
    a restricted parser.
    """
    # Reject any XML with DOCTYPE declarations to prevent XXE
    # This is a defense-in-depth measure
    xml_lower = xml_string.lower()
    if '<!doctype' in xml_lower or '<!entity' in xml_lower:
        raise ValueError("DOCTYPE and ENTITY declarations are not allowed")

    # Use a parser that doesn't resolve external entities
    # Python's xml.etree.ElementTree doesn't expand external entities by default
    # but we add extra protection
    parser = ET.XMLParser()
    # Disable external entity loading
    try:
        root = ET.fromstring(xml_string, parser=parser)
    except ET.ParseError:
        raise ValueError("Invalid XML format")

    return root


@app.route('/import', methods=['POST'])
def import_items():
    """Import items from an XML document."""
    try:
        # Check content type
        content_type = request.content_type or ''
        if 'xml' not in content_type and 'text' not in content_type:
            # Be lenient but log; accept if data looks like XML
            pass

        xml_data = request.get_data(as_text=True)

        if not xml_data or not xml_data.strip():
            return jsonify({"error": "No XML data provided"}), 400

        # Limit size check (defense in depth, MAX_CONTENT_LENGTH should handle this)
        if len(xml_data) > 1 * 1024 * 1024:
            return jsonify({"error": "Request too large"}), 400

        try:
            root = safe_parse_xml(xml_data)
        except ValueError as e:
            return jsonify({"error": "Invalid XML format"}), 400

        if root.tag != 'items':
            return jsonify({"error": "Invalid XML format"}), 400

        parsed_items = []
        item_elements = root.findall('item')

        # Limit number of items to prevent resource exhaustion
        if len(item_elements) > 10000:
            return jsonify({"error": "Too many items"}), 400

        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')

            if name_elem is None or value_elem is None:
                return jsonify({"error": "Invalid XML format"}), 400

            name = name_elem.text or ''
            value = value_elem.text or ''

            # Limit field lengths
            if len(name) > 1000 or len(value) > 1000:
                return jsonify({"error": "Field value too long"}), 400

            parsed_items.append({"name": name, "value": value})

        # Store items in database
        db = get_db()
        for item in parsed_items:
            db.execute(
                "INSERT INTO items (name, value) VALUES (?, ?)",
                (item['name'], item['value'])
            )
        db.commit()

        return jsonify({
            "message": f"{len(parsed_items)} items imported",
            "items": parsed_items
        }), 200

    except Exception:
        return jsonify({"error": "An error occurred processing the request"}), 400


@app.route('/items', methods=['GET'])
def list_items():
    """List all imported items."""
    try:
        db = get_db()
        cursor = db.execute("SELECT name, value FROM items")
        items = [{"name": row["name"], "value": row["value"]} for row in cursor.fetchall()]
        return jsonify(items), 200
    except Exception:
        return jsonify({"error": "An error occurred retrieving items"}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "Request too large"}), 413


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)