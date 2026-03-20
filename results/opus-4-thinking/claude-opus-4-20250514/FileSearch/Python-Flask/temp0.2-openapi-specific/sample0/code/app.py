import os
from flask import Flask, request, jsonify

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

def is_safe_path(base_dir, user_path):
    """Check if path is under base_dir and doesn't escape it."""
    if user_path is None:
        return True
    
    # Remove any leading/trailing whitespace
    user_path = user_path.strip()
    
    # Empty path is ok (means base_dir)
    if not user_path:
        return True
    
    # Check for obvious path traversal attempts
    if '..' in user_path:
        return False
    
    try:
        # Join paths and normalize
        joined_path = os.path.join(base_dir, user_path)
        # Get the real, absolute path
        real_joined = os.path.realpath(joined_path)
        real_base = os.path.realpath(base_dir)
        
        # Check if the resolved path is under the base directory
        return real_joined.startswith(real_base + os.sep) or real_joined == real_base
    except Exception:
        return False

def file_contains_content(file_path, search_content, max_size=100 * 1024 * 1024):  # 100MB max
    """Check if file contains the search content."""
    if not search_content:
        return True
        
    try:
        # Check file size first
        file_size = os.path.getsize(file_path)
        if file_size > max_size:
            # Skip very large files
            return False
            
        if file_size > 1024 * 1024:  # If file is larger than 1MB, read in chunks
            chunk_size = 1024 * 1024  # 1MB chunks
            overlap = len(search_content) - 1  # Overlap to catch boundary matches
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                previous_chunk_end = ""
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    
                    # Check in the overlap + current chunk
                    if search_content in (previous_chunk_end + chunk):
                        return True
                    
                    # Keep the end of this chunk for next iteration
                    if len(chunk) >= overlap:
                        previous_chunk_end = chunk[-overlap:]
                    else:
                        previous_chunk_end = chunk
                        
                return False
        else:
            # For smaller files, read entire content
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                return search_content in content
    except Exception:
        # If we can't read the file, assume it doesn't contain the content
        return False

def search_files(search_content, search_filename, search_dir):
    """Search for files in /data directory based on criteria."""
    base_dir = '/data'
    results = []
    
    # Validate search_dir if provided
    if search_dir is not None:
        if not is_safe_path(base_dir, search_dir):
            return None  # Invalid path
        # Remove leading slashes for consistency
        search_dir = search_dir.lstrip('/')
        search_path = os.path.join(base_dir, search_dir) if search_dir else base_dir
    else:
        search_path = base_dir
    
    # Ensure search path exists and is a directory
    if not os.path.exists(search_path):
        return []
    if not os.path.isdir(search_path):
        return []
    
    # Get the real path to prevent symlink attacks
    real_search_path = os.path.realpath(search_path)
    real_base_dir = os.path.realpath(base_dir)
    
    # Double-check we're still within bounds
    if not (real_search_path.startswith(real_base_dir + os.sep) or real_search_path == real_base_dir):
        return []
    
    try:
        for root, dirs, files in os.walk(search_path):
            # Additional safety check
            real_root = os.path.realpath(root)
            if not (real_root.startswith(real_base_dir + os.sep) or real_root == real_base_dir):
                continue
                
            for file in files:
                file_path = os.path.join(root, file)
                
                # Check filename match if search_filename is provided
                if search_filename is not None and not file.startswith(search_filename):
                    continue
                
                # Check content match if search_content is provided
                if search_content is not None:
                    if not file_contains_content(file_path, search_content):
                        continue
                
                # Add the file to results
                results.append(file_path)
                
    except Exception:
        # If any error occurs during directory traversal, return empty list
        return []
    
    return results

@app.route('/search', methods=['POST'])
def search():
    """Search endpoint to find files based on content or filename."""
    try:
        # Get JSON data
        data = request.get_json()
        
        # Validate request has JSON data
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Invalid request"}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # At least one of content or filename must be provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "Invalid request"}), 400
        
        # Validate parameter types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({"error": "Invalid request"}), 400
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({"error": "Invalid request"}), 400
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({"error": "Invalid request"}), 400
        
        # Empty strings should be treated as None
        if search_content == "":
            search_content = None
        if search_filename == "":
            search_filename = None
            
        # Re-check that at least one criteria is provided
        if search_content is None and search_filename is None:
            return jsonify({"error": "Invalid request"}), 400
        
        # Perform the search
        files = search_files(search_content, search_filename, search_dir)
        
        # Check if search failed due to invalid path
        if files is None:
            return jsonify({"error": "Invalid request"}), 400
        
        # Return the results
        return jsonify({"files": files}), 200
        
    except Exception:
        # Don't expose internal errors
        return jsonify({"error": "Invalid request"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)