import sqlite3
import xml.etree.ElementTree as ET
from flask import Flask, request, jsonify
import logging

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATABASE = 'db.sqlite3'
MAX_ITEMS_PER_IMPORT = 10000

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    try:
        conn = get_db()
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
    except Exception:
        logger.error("Database initialization failed")

def parse_xml_safely(xml_data):
    try:
        root = ET.fromstring(xml_data)
        return root
    except ET.ParseError:
        raise ValueError("Invalid XML")
    except Exception:
        raise ValueError("XML parsing failed")

def extract_items_from_xml(root):
    items = []
    try:
        for item_elem in root.findall('item'):
            if len(items) >= MAX_ITEMS_PER_IMPORT:
                break
            
            name_elem = item_elem.find('name')
            value_elem = item_elem.find('value')
            
            if name_elem is not None and value_elem is not None:
                name = name_elem.text
                value = value_elem.text
                
                if name and value:
                    items.append({
                        'name': str(name).strip()[:255],
                        'value': str(value).strip()[:255]
                    })
    except Exception:
        raise ValueError("Failed to extract items")
    
    return items

def store_items(items):
    try:
        conn = get_db()
        cursor = conn.cursor()
        count = 0
        
        for item in items:
            cursor.execute(
                'INSERT INTO items (name, value) VALUES (?, ?)',
                (item['name'], item['value'])
            )
            count += 1
        
        conn.commit()
        conn.close()
        return count
    except Exception:
        logger.error("Database error")
        raise Exception("Storage failed")

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

@app.route('/import', methods=['POST'])
def import_items():
    try:
        if not request.data:
            return jsonify({'error': 'No data provided'}), 400
        
        if request.content_length and request.content_length > app.config['MAX_CONTENT_LENGTH']:
            return jsonify({'error': 'Request too large'}), 413
        
        try:
            root = parse_xml_safely(request.data)
            items = extract_items_from_xml(root)
            
            if not items:
                return jsonify({'error': 'Invalid XML format'}), 400
            
            count = store_items(items)
            
            return jsonify({
                'message': f'{count} items imported',
                'items': items
            }), 200
            
        except ValueError:
            return jsonify({'error': 'Invalid XML format'}), 400
        except Exception:
            logger.error("Import processing error")
            return jsonify({'error': 'An error occurred'}), 400
    
    except Exception:
        logger.error("Unexpected import error")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/items', methods=['GET'])
def get_items():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT name, value FROM items LIMIT 50000')
        rows = cursor.fetchall()
        conn.close()
        
        items = [{'name': row['name'], 'value': row['value']} for row in rows]
        return jsonify(items), 200
        
    except Exception:
        logger.error("Retrieval error")
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({'error': 'Request too large'}), 413

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)