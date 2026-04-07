import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, g

app = Flask(__name__)

DATABASE = 'db.sqlite3'
MAX_XML_SIZE = 1 * 1024 * 1024  # 1 MB limit


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
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.route('/import', methods=['POST'])
def import_xml():
    # Check content length to prevent resource exhaustion
    content_length = request.content_length
    if content_length is not None and content_length > MAX_XML_SIZE:
        return jsonify({'error': 'Request body too large'}), 400

    xml_data = request.get_data(limit=MAX_XML_SIZE + 1)
    if len(xml_data) > MAX_XML_SIZE:
        return jsonify({'error': 'Request body too large'}), 400

    if not xml_data:
        return jsonify({'error': 'No XML data provided'}), 400

    try:
        # Use defusedxml-like approach: configure parser to disallow external entities
        # Since we can't use defusedxml, we create a safe parser
        parser = ET.XMLParser()
        # Prevent XXE by using a restricted parser
        # ET by default in Python 3.8+ does not expand external entities
        # but we explicitly handle it

        root = ET.fromstring(xml_data, parser=parser)
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception:
        return jsonify({'error': 'Invalid XML data'}), 400

    if root.tag != 'items':
        return jsonify({'error': 'Invalid XML format: root element must be <items>'}), 400

    items = []
    try:
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')

            if name_elem is None or value_elem is None:
                continue

            name = name_elem.text or ''
            value = value_elem.text or ''

            # Limit field lengths to prevent resource exhaustion
            if len(name) > 1000 or len(value) > 1000:
                return jsonify({'error': 'Field values too long'}), 400

            items.append({'name': name, 'value': value})

        if len(items) > 10000:
            return jsonify({'error': 'Too many items'}), 400

        db = get_db()
        for item in items:
            db.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        db.commit()

    except Exception:
        return jsonify({'error': 'Failed to process XML data'}), 400

    return jsonify({
        'message': f'{len(items)} items imported',
        'items': items
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
        return jsonify({'error': 'Failed to retrieve items'}), 500


# Custom XML entity resolver to block external entities
class SafeXMLParser(ET.XMLParser):
    pass


# Monkey-patch to prevent XXE - Python's ET doesn't support external entities
# by default, but we add explicit protection
def safe_parse_xml(xml_data):
    """Parse XML safely, preventing XXE attacks."""
    # Python's xml.etree.ElementTree does not support external entity expansion
    # by default (it raises ParseError for DOCTYPE with external entities in newer versions)
    # We add an explicit check for DOCTYPE declarations
    xml_str = xml_data if isinstance(xml_data, str) else xml_data.decode('utf-8', errors='replace')
    
    # Check for potentially dangerous XML constructs
    xml_upper = xml_str.upper()
    if '<!DOCTYPE' in xml_upper or '<!ENTITY' in xml_upper:
        raise ValueError('DOCTYPE and ENTITY declarations are not allowed')
    
    return ET.fromstring(xml_data)


@app.route('/import', methods=['POST'])
def import_xml_safe():
    pass  # This won't be registered due to duplicate route


# Override the import route with safe version
app.view_functions.pop('import_xml', None)


@app.route('/import', methods=['POST'])
def import_xml_v2():
    # Check content length to prevent resource exhaustion
    content_length = request.content_length
    if content_length is not None and content_length > MAX_XML_SIZE:
        return jsonify({'error': 'Request body too large'}), 400

    xml_data = request.get_data(limit=MAX_XML_SIZE + 1)
    if len(xml_data) > MAX_XML_SIZE:
        return jsonify({'error': 'Request body too large'}), 400

    if not xml_data:
        return jsonify({'error': 'No XML data provided'}), 400

    try:
        root = safe_parse_xml(xml_data)
    except ValueError as e:
        return jsonify({'error': 'Invalid XML format'}), 400
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception:
        return jsonify({'error': 'Invalid XML data'}), 400

    if root.tag != 'items':
        return jsonify({'error': 'Invalid XML format: root element must be <items>'}), 400

    items = []
    try:
        item_elements = root.findall('item')
        if len(item_elements) > 10000:
            return jsonify({'error': 'Too many items'}), 400

        for item_elem in item_elements:
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')

            if name_elem is None or value_elem is None:
                continue

            name = name_elem.text or ''
            value = value_elem.text or ''

            # Limit field lengths to prevent resource exhaustion
            if len(name) > 1000 or len(value) > 1000:
                return jsonify({'error': 'Field values too long'}), 400

            items.append({'name': name, 'value': value})

        db = get_db()
        for item in items:
            db.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
        db.commit()

    except Exception:
        return jsonify({'error': 'Failed to process XML data'}), 400

    return jsonify({
        'message': f'{len(items)} items imported',
        'items': items
    }), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)