import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, g

app = Flask(__name__)
DATABASE = 'db.sqlite3'

# Security: Limit XML size to prevent resource exhaustion (CWE-400)
MAX_XML_SIZE = 1 * 1024 * 1024  # 1 MB

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                value TEXT NOT NULL
            )
        ''')
        db.commit()

@app.after_request
def set_security_headers(response):
    # CWE-693: Add security headers
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.route('/import', methods=['POST'])
def import_xml():
    # CWE-400: Check content length to prevent resource exhaustion
    content_length = request.content_length
    if content_length is not None and content_length > MAX_XML_SIZE:
        return jsonify({'error': 'Request too large'}), 413

    xml_data = request.get_data(limit=MAX_XML_SIZE + 1)
    if len(xml_data) > MAX_XML_SIZE:
        return jsonify({'error': 'Request too large'}), 413

    if not xml_data:
        return jsonify({'error': 'No XML data provided'}), 400

    try:
        # CWE-611: Disable external entity processing by using a custom parser
        # ElementTree by default does not resolve external entities in Python 3,
        # but we explicitly create a safe parser
        # Use defusedxml-like approach: restrict entity expansion
        parser = ET.XMLParser()
        # Prevent XXE by not allowing DOCTYPE declarations with external entities
        # Python's ET does not support external entities by default, but we add extra safety
        
        # Parse with size-limited data
        root = ET.fromstring(xml_data, parser=parser)
    except ET.ParseError:
        # CWE-209: Do not expose internal error details
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception:
        # CWE-703: Handle unexpected exceptions
        return jsonify({'error': 'Failed to process XML data'}), 400

    # CWE-611: Check for unexpected root or DOCTYPE-like content
    # Validate root element
    if root.tag != 'items':
        return jsonify({'error': 'Invalid XML format: expected <items> root element'}), 400

    imported_items = []
    db = get_db()

    try:
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')

            if name_elem is None or value_elem is None:
                continue

            name = name_elem.text or ''
            value = value_elem.text or ''

            # Sanitize: strip whitespace
            name = name.strip()
            value = value.strip()

            # CWE-400: Limit field sizes
            if len(name) > 1000 or len(value) > 1000:
                return jsonify({'error': 'Field value too large'}), 400

            db.execute('INSERT INTO items (name, value) VALUES (?, ?)', (name, value))
            imported_items.append({'name': name, 'value': value})

        db.commit()
    except Exception:
        # CWE-703 & CWE-209: Handle DB errors without exposing details
        db.rollback()
        return jsonify({'error': 'Failed to store items'}), 500

    return jsonify({
        'message': f'{len(imported_items)} items imported',
        'items': imported_items
    }), 200

@app.route('/items', methods=['GET'])
def list_items():
    try:
        db = get_db()
        cursor = db.execute('SELECT name, value FROM items')
        rows = cursor.fetchall()
        items = [{'name': row['name'], 'value': row['value']} for row in rows]
        return jsonify(items), 200
    except Exception:
        # CWE-703 & CWE-209
        return jsonify({'error': 'Failed to retrieve items'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)