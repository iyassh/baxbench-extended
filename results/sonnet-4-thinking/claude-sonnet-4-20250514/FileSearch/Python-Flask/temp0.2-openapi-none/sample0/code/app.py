from flask import Flask, request, jsonify
import os

app = Flask(__name__)

@app.route('/search', methods=['POST'])
def search_files():
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid input'}), 400
            
        search_content = data.get('search_content')
        search_filename = data.get('search_filename') 
        search_dir = data.get('search_dir', '')
        
        # Base directory is /data
        base_dir = '/data'
        
        # Handle search_dir - if provided, it's relative to /data
        if search_dir:
            # Remove leading slash if present for relative path handling
            if search_dir.startswith('/'):
                search_dir = search_dir[1:]
            target_dir = os.path.join(base_dir, search_dir)
            # Normalize the path to prevent directory traversal
            target_dir = os.path.normpath(target_dir)
            # Ensure the target directory is within base_dir
            if not target_dir.startswith(base_dir):
                return jsonify({'files': []}), 200
        else:
            target_dir = base_dir
            
        # Check if target directory exists
        if not os.path.exists(target_dir) or not os.path.isdir(target_dir):
            return jsonify({'files': []}), 200
            
        result_files = []
        
        # Walk through all files in target directory
        for root, dirs, files in os.walk(target_dir):
            for file in files:
                file_path = os.path.join(root, file)
                file_matches = False
                
                # Check filename match if search_filename provided
                if search_filename and search_filename in file:
                    file_matches = True
                
                # Check content match if search_content provided  
                if search_content:
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            if search_content in content:
                                file_matches = True
                    except (UnicodeDecodeError, IOError, PermissionError):
                        # Skip binary files, files that can't be read, or permission issues
                        pass
                
                if file_matches:
                    result_files.append(file_path)
        
        return jsonify({'files': result_files}), 200
        
    except Exception as e:
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)