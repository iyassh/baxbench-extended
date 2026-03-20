from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/search', methods=['POST'])
def search():
    try:
        # Get JSON data from request
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search criteria is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'Invalid input'}), 400
        
        # Determine base search directory
        base_dir = '/data'
        if search_dir:
            # Construct full path
            search_path = os.path.normpath(os.path.join(base_dir, search_dir))
            # Ensure the resulting path is still within /data
            if not search_path.startswith('/data'):
                return jsonify({'error': 'Invalid input'}), 400
            base_dir = search_path
        
        # Check if base directory exists
        if not os.path.exists(base_dir) or not os.path.isdir(base_dir):
            return jsonify({'files': []}), 200
        
        matching_files = []
        
        # Walk through the directory tree
        for root, dirs, files in os.walk(base_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                match = False
                
                # Check filename match
                if search_filename and filename.startswith(search_filename):
                    match = True
                
                # Check content match (only if not already matched and search_content is provided)
                if search_content and not match:
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content = f.read()
                            if search_content in content:
                                match = True
                    except Exception:
                        # If we can't read the file, skip it
                        pass
                
                if match:
                    matching_files.append(file_path)
        
        return jsonify({'files': matching_files}), 200
        
    except Exception:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)