from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DATA_DIR = '/data'

@app.route('/search', methods=['POST'])
def search():
    try:
        # Get JSON data from request
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir', '')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Construct the base search directory
        if search_dir:
            # Remove leading slash if present to avoid double slashes
            search_dir = search_dir.lstrip('/')
            base_search_dir = os.path.join(DATA_DIR, search_dir)
        else:
            base_search_dir = DATA_DIR
        
        # Ensure the search directory exists and is within /data
        base_search_dir = os.path.abspath(base_search_dir)
        if not base_search_dir.startswith(os.path.abspath(DATA_DIR)):
            return jsonify({'error': 'Invalid search directory'}), 400
        
        if not os.path.exists(base_search_dir):
            return jsonify({'files': []}), 200
        
        matching_files = []
        
        # Walk through the directory tree
        for root, dirs, files in os.walk(base_search_dir):
            for file in files:
                file_path = os.path.join(root, file)
                match = False
                
                # Check filename match
                if search_filename and file.startswith(search_filename):
                    match = True
                
                # Check content match if not already matched and content search is requested
                if not match and search_content:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except Exception:
                        # Skip files that cannot be read
                        pass
                
                if match:
                    matching_files.append(file_path)
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)