import os
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security configuration
app.config['JSON_SORT_KEYS'] = False
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False

# Base data directory
DATA_DIR = '/data'

def validate_and_normalize_path(search_dir):
    """Validate and normalize the search directory to prevent path traversal attacks."""
    if search_dir is None or search_dir == '':
        return DATA_DIR
    
    # Remove any leading/trailing whitespace and slashes
    search_dir = search_dir.strip().strip('/')
    
    # Construct the full path
    full_path = os.path.join(DATA_DIR, search_dir)
    
    # Normalize the path to resolve any '..' or '.' components
    normalized_path = os.path.normpath(full_path)
    
    # Ensure the normalized path is still within DATA_DIR
    if not normalized_path.startswith(DATA_DIR):
        raise ValueError("Invalid search directory")
    
    return normalized_path

def search_files(search_content, search_filename, search_dir):
    """Search for files based on content or filename."""
    matching_files = []
    
    try:
        # Validate and normalize the search directory
        base_search_dir = validate_and_normalize_path(search_dir)
        
        # Check if the directory exists
        if not os.path.exists(base_search_dir):
            return []
        
        if not os.path.isdir(base_search_dir):
            return []
        
        # Walk through the directory tree
        for root, dirs, files in os.walk(base_search_dir):
            for file in files:
                file_path = os.path.join(root, file)
                
                # Check filename match
                if search_filename and file.startswith(search_filename):
                    if file_path not in matching_files:
                        matching_files.append(file_path)
                
                # Check content match
                if search_content:
                    try:
                        # Only try to read text files to avoid binary file issues
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            # Read file in chunks to handle large files
                            chunk_size = 8192
                            while True:
                                chunk = f.read(chunk_size)
                                if not chunk:
                                    break
                                if search_content in chunk:
                                    if file_path not in matching_files:
                                        matching_files.append(file_path)
                                    break
                    except (IOError, OSError):
                        # Skip files that cannot be read
                        continue
                    except Exception:
                        # Skip any other unexpected errors
                        continue
    
    except ValueError:
        # Invalid search directory
        return []
    except Exception:
        # Handle any other unexpected errors
        return []
    
    return matching_files

@app.route('/search', methods=['POST'])
def search():
    """Search endpoint for finding files by content or filename."""
    try:
        # Parse JSON request body
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json(force=True)
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Validate that at least one search criterion is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one of search_content or search_filename must be provided'}), 400
        
        # Validate input types
        if search_content is not None and not isinstance(search_content, str):
            return jsonify({'error': 'search_content must be a string'}), 400
        
        if search_filename is not None and not isinstance(search_filename, str):
            return jsonify({'error': 'search_filename must be a string'}), 400
        
        if search_dir is not None and not isinstance(search_dir, str):
            return jsonify({'error': 'search_dir must be a string'}), 400
        
        # Perform the search
        matching_files = search_files(search_content, search_filename, search_dir)
        
        # Return the results
        response = jsonify({'files': matching_files})
        
        # Add security headers
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'none'"
        
        return response, 200
    
    except BadRequest:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON in request body'}), 400
    except Exception:
        # Don't expose internal error details
        return jsonify({'error': 'An error occurred processing your request'}), 400

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors without exposing sensitive information."""
    response = jsonify({'error': 'Not found'})
    response.status_code = 404
    return response

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors without exposing sensitive information."""
    response = jsonify({'error': 'Internal server error'})
    response.status_code = 500
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)