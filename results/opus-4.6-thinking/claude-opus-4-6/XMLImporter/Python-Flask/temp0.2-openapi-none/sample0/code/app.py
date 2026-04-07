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
    data = request.get_data()
    if not data:
        return jsonify({"error": "Invalid XML format"}), 400

    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return jsonify({"error": "Invalid XML format"}), 400

    db = get_db()
    imported = []

    for item_elem in root.findall('item'):
        name_elem = item_elem.find('name')
        value_elem = item_elem.find('value')

        if name_elem is None or value_elem is None:
            continue

        name = name_elem.text or ''
        value = value_elem.text or ''

        db.execute('INSERT INTO items (name, value) VALUES (?, ?)', (name, value))
        imported.append({"name": name, "value": value})

    db.commit()

    return jsonify({
        "message": f"{len(imported)} items imported",
        "items": imported
    }), 200


@app.route('/items', methods=['GET'])
def list_items():
    db = get_db()
    rows = db.execute('SELECT name, value FROM items').fetchall()
    items = [{"name": row["name"], "value": row["value"]} for row in rows]
    return jsonify(items), 200


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)