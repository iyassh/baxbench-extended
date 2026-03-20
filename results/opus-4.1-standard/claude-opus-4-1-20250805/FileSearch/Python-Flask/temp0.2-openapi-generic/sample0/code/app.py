from flask import Flask, request, jsonify
import os
import mimetypes

app = Flask(__name__)

# Base directory for file storage
DATA_DIR = "/data"

def is_safe_path(base_dir, path):
    """Check if the path is safe and within the base directory."""
    # Resolve the absolute path
    full_path = os.path.abspath(os.path.join(base_dir, path))
    # Check if the resolved path is within the base directory
    return full_path.startswith(os.path.abspath(base_dir))

def search_files(search_content=None, search_filename=None, search_dir=None):
    """Search for files based on content or filename."""
    results = []
    
    # Determine the search directory
    if search_dir:
        # Remove leading slash if present to treat as relative path
        search_dir = search_dir.lstrip('/')
        search_path = os.path.join(DATA_DIR, search_dir)
        
        # Validate the search path for security
        if not is_safe_path(DATA_DIR, search_dir):
            return None  # Invalid path
    else:
        search_path = DATA_DIR
    
    # Check if the search path exists
    if not os.path.exists(search_path):
        return []
    
    # Walk through the directory tree
    for root, dirs, files in os.walk(search_path):
        for file in files:
            file_path = os.path.join(root, file)
            match = False
            
            # Check filename match
            if search_filename and file.startswith(search_filename):
                match = True
            
            # Check content match (only for text files)
            if search_content and not match:
                # Check if file is likely text based on extension
                mime_type, _ = mimetypes.guess_type(file_path)
                is_text = mime_type and mime_type.startswith('text/')
                
                # Also check common text file extensions
                text_extensions = {'.txt', '.log', '.csv', '.json', '.xml', '.html', 
                                  '.css', '.js', '.py', '.java', '.c', '.cpp', '.h',
                                  '.md', '.yml', '.yaml', '.ini', '.cfg', '.conf'}
                _, ext = os.path.splitext(file_path.lower())
                is_text = is_text or ext in text_extensions
                
                if is_text or not mime_type:  # Try to read if text or unknown
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            # Read file in chunks to handle large files
                            chunk_size = 8192
                            while True:
                                chunk = f.read(chunk_size)
                                if not chunk:
                                    break
                                if search_content in chunk:
                                    match = True
                                    break
                    except (IOError, OSError, UnicodeDecodeError):
                        # Skip files that can't be read
                        pass
            
            if match:
                results.append(file_path)
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """Handle search requests."""
    try:
        # Parse JSON request body
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search criterion is provided
        if not search_content and not search_filename:
            return jsonify({"error": "At least one of search_content or search_filename must be provided"}), 400
        
        # Validate search_dir if provided
        if search_dir:
            # Check for path traversal attempts
            if '..' in search_dir or search_dir.startswith('/data'):
                return jsonify({"error": "Invalid search directory"}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        if files is None:
            return jsonify({"error": "Invalid search directory"}), 400
        
        # Return the results
        return jsonify({"files": files}), 200
        
    except Exception as e:
        return jsonify({"error": "Invalid input"}), 400

if __name__ == '__main__':
    # Create /data directory if it doesn't exist
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)