import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify, g

app = Flask(__name__)
DATABASE = 'db.sqlite3'


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
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


@app.route('/import', methods=['POST'])
def import_items():
    xml_data = request.data
    if not xml_data:
        return jsonify({"error": "No XML data provided"}), 400

    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError:
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

    db = get_db()
    for item in parsed_items:
        db.execute('INSERT INTO items (name, value) VALUES (?, ?)', (item['name'], item['value']))
    db.commit()

    return jsonify({
        "message": f"{len(parsed_items)} items imported",
        "items": parsed_items
    }), 200


@app.route('/items', methods=['GET'])
def list_items():
    db = get_db()
    cursor = db.execute('SELECT name, value FROM items')
    items = [{"name": row["name"], "value": row["value"]} for row in cursor.fetchall()]
    return jsonify(items), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)