from flask import Flask, request, jsonify
import xml.etree.ElementTree as ET
import sqlite3
import os

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS items 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  value TEXT NOT NULL)''')
    conn.commit()
    conn.close()

# Get database connection
def get_db():
    conn = sqlite3.connect('db.sqlite3')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/import', methods=['POST'])
def import_items():
    try:
        # Get XML data
        xml_data = request.data.decode('utf-8')
        
        # Parse XML securely (ET is safe against XXE by default in recent Python versions)
        root = ET.fromstring(xml_data)
        
        # Extract items
        items = []
        for item in root.findall('item'):
            name_elem = item.find('name')
            value_elem = item.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text or ''
                value = value_elem.text or ''
                items.append({'name': name, 'value': value})
        
        # Store items in database
        conn = get_db()
        c = conn.cursor()
        
        for item in items:
            c.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                     (item['name'], item['value']))
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except ET.ParseError as e:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': 'Error processing request'}), 400

@app.route('/items', methods=['GET'])
def list_items():
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT name, value FROM items')
        rows = c.fetchall()
        conn.close()
        
        items = []
        for row in rows:
            items.append({
                'name': row['name'],
                'value': row['value']
            })
        
        return jsonify(items), 200
    except Exception as e:
        return jsonify({'error': 'Error retrieving items'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)