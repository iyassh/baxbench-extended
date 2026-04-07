from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Database setup
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS items
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  value TEXT NOT NULL)''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    try:
        # Get XML data from request
        xml_data = request.data.decode('utf-8')
        
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Validate root element
        if root.tag != 'items':
            return jsonify({'error': 'Invalid XML format'}), 400
        
        # Parse items
        items = []
        for item_elem in root.findall('item'):
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is None or value_elem is None:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            name = name_elem.text or ''
            value = value_elem.text or ''
            items.append({'name': name, 'value': value})
        
        # Store in database
        conn = get_db_connection()
        for item in items:
            conn.execute('INSERT INTO items (name, value) VALUES (?, ?)',
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
def list_items():
    conn = get_db_connection()
    items = conn.execute('SELECT name, value FROM items').fetchall()
    conn.close()
    
    return jsonify([{'name': item['name'], 'value': item['value']} for item in items])

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000)