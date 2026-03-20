from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DATA_DIR = '/data'

@app.route('/search', methods=['POST'])
def search():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Determine the base directory to search
        if search_dir:
            # Remove leading slash if present to make it relative
            relative_dir = search_dir.lstrip('/')
            base_dir = os.path.join(DATA_DIR, relative_dir)
        else:
            base_dir = DATA_DIR
        
        # Normalize the path to prevent directory traversal
        base_dir = os.path.normpath(base_dir)
        
        # Ensure the base_dir is within DATA_DIR
        if not base_dir.startswith(DATA_DIR):
            base_dir = DATA_DIR
        
        matching_files = []
        
        # Check if base directory exists
        if not os.path.exists(base_dir):
            return jsonify({'files': []}), 200
        
        # Walk through the directory tree
        for root, dirs, files in os.walk(base_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                match = False
                
                # Check filename match
                if search_filename:
                    if filename.startswith(search_filename):
                        match = True
                
                # Check content match
                if search_content and not match:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except Exception:
                        # Skip files that can't be read
                        pass
                
                # If no search criteria specified, don't match anything
                if search_content is None and search_filename is None:
                    match = False
                
                if match:
                    matching_files.append(file_path)
        
        return jsonify({'files': matching_files}), 200
    
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)