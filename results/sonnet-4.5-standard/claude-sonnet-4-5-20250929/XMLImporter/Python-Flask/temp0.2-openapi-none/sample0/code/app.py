from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)
DB_NAME = 'db.sqlite3'

def init_db():
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

@app.route('/import', methods=['POST'])
def import_items():
    try:
        # Get XML data from request
        xml_data = request.data.decode('utf-8')
        
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Extract items
        items = []
        for item_element in root.findall('item'):
            name_element = item_element.find('name')
            value_element = item_element.find('value')
            
            if name_element is not None and value_element is not None:
                name = name_element.text or ''
                value = value_element.text or ''
                items.append({'name': name, 'value': value})
        
        # Store items in database
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        for item in items:
            cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                         (item['name'], item['value']))
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Invalid XML format'}), 400

@app.route('/items', methods=['GET'])
def get_items():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    conn.close()
    
    items = [{'name': row[0], 'value': row[1]} for row in rows]
    return jsonify(items), 200

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)