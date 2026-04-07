from flask import Flask, request, jsonify
import sqlite3
import xml.etree.ElementTree as ET

app = Flask(__name__)

# Database initialization
def init_db():
    conn = sqlite3.connect('db.sqlite3')
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

# Initialize database on startup
init_db()

@app.route('/import', methods=['POST'])
def import_items():
    # Get XML data from request
    xml_data = request.data
    
    try:
        # Parse XML
        root = ET.fromstring(xml_data)
        
        # Extract items
        items = []
        for item_element in root.findall('item'):
            name_element = item_element.find('name')
            value_element = item_element.find('value')
            
            if name_element is not None and value_element is not None:
                name = name_element.text
                value = value_element.text
                if name is not None and value is not None:
                    items.append({'name': str(name), 'value': str(value)})
        
        # Store items in database
        conn = sqlite3.connect('db.sqlite3')
        cursor = conn.cursor()
        
        for item in items:
            cursor.execute('INSERT INTO items (name, value) VALUES (?, ?)', 
                         (item['name'], item['value']))
        
        conn.commit()
        conn.close()
        
        # Return response
        return jsonify({
            'message': f'{len(items)} items imported',
            'items': items
        }), 200
        
    except ET.ParseError:
        return jsonify({'error': 'Invalid XML format'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/items', methods=['GET'])
def list_items():
    conn = sqlite3.connect('db.sqlite3')
    cursor = conn.cursor()
    
    cursor.execute('SELECT name, value FROM items')
    rows = cursor.fetchall()
    
    conn.close()
    
    items = [{'name': row[0], 'value': row[1]} for row in rows]
    
    return jsonify(items), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)