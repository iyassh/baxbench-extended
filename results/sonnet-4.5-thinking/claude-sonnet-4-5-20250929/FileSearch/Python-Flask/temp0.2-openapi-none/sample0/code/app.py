from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DATA_DIR = "/data"

@app.route('/search', methods=['POST'])
def search():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON"}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Determine the base directory to search in
        if search_dir:
            # Remove leading slash if present
            if search_dir.startswith('/'):
                search_dir = search_dir[1:]
            base_dir = os.path.join(DATA_DIR, search_dir)
        else:
            base_dir = DATA_DIR
        
        # Prevent directory traversal
        real_base = os.path.realpath(base_dir)
        real_data = os.path.realpath(DATA_DIR)
        if not (real_base == real_data or real_base.startswith(real_data + os.sep)):
            return jsonify({"error": "Invalid search directory"}), 400
        
        # Ensure the base directory exists and is a directory
        if not os.path.exists(base_dir) or not os.path.isdir(base_dir):
            return jsonify({"files": []}), 200
        
        matching_files = []
        
        # Walk through the directory tree
        for root, dirs, files in os.walk(base_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                match = False
                
                # If no search criteria, match all files
                if not search_content and not search_filename:
                    match = True
                else:
                    # Check filename match (starts with)
                    if search_filename and filename.startswith(search_filename):
                        match = True
                    
                    # Check content match (only if not already matched)
                    if not match and search_content:
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                if search_content in content:
                                    match = True
                        except Exception:
                            # Skip files that can't be read
                            pass
                
                if match:
                    matching_files.append(file_path)
        
        return jsonify({"files": matching_files}), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)