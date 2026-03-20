from flask import Flask, request, jsonify
import os
import json
from pathlib import Path

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

def is_safe_path(path, base_path):
    """Check if the path is safe and within the base directory"""
    try:
        # Resolve the path to get absolute path
        resolved_path = Path(path).resolve()
        base_resolved = Path(base_path).resolve()
        
        # Check if the resolved path is within the base directory
        return str(resolved_path).startswith(str(base_resolved))
    except (OSError, ValueError):
        return False

def search_files_by_content(content, search_dir):
    """Search for files containing specific content"""
    matching_files = []
    
    try:
        for root, dirs, files in os.walk(search_dir):
            # Ensure we don't traverse outside the allowed directory
            if not is_safe_path(root, '/data'):
                continue
                
            for file in files:
                file_path = os.path.join(root, file)
                
                # Additional safety check for each file
                if not is_safe_path(file_path, '/data'):
                    continue
                
                try:
                    # Try to read file as text with different encodings
                    encodings = ['utf-8', 'latin-1', 'ascii']
                    file_content = None
                    
                    for encoding in encodings:
                        try:
                            with open(file_path, 'r', encoding=encoding) as f:
                                file_content = f.read()
                            break
                        except UnicodeDecodeError:
                            continue
                    
                    if file_content and content.lower() in file_content.lower():
                        matching_files.append(file_path)
                        
                except (IOError, OSError, PermissionError):
                    # Skip files that cannot be read
                    continue
                    
    except (OSError, PermissionError):
        # Handle directory access errors silently
        pass
    
    return matching_files

def search_files_by_name(filename, search_dir):
    """Search for files matching filename pattern"""
    matching_files = []
    
    try:
        for root, dirs, files in os.walk(search_dir):
            # Ensure we don't traverse outside the allowed directory
            if not is_safe_path(root, '/data'):
                continue
                
            for file in files:
                if file.startswith(filename):
                    file_path = os.path.join(root, file)
                    
                    # Additional safety check for each file
                    if is_safe_path(file_path, '/data'):
                        matching_files.append(file_path)
                        
    except (OSError, PermissionError):
        # Handle directory access errors silently
        pass
    
    return matching_files

@app.route('/search', methods=['POST'])
def search_files():
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.get_json()
        
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir', '')
        
        # Validate that at least one search parameter is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'Either search_content or search_filename must be provided'}), 400
        
        # Construct the search directory path
        base_data_dir = '/data'
        
        if search_dir:
            # Remove leading slash if present to treat as relative path
            if search_dir.startswith('/'):
                search_dir = search_dir[1:]
            
            # Construct full search path
            full_search_dir = os.path.join(base_data_dir, search_dir)
        else:
            full_search_dir = base_data_dir
        
        # Validate the search directory is safe
        if not is_safe_path(full_search_dir, base_data_dir):
            return jsonify({'error': 'Invalid search directory'}), 400
        
        # Check if the search directory exists
        if not os.path.exists(full_search_dir) or not os.path.isdir(full_search_dir):
            return jsonify({'files': []}), 200
        
        matching_files = []
        
        # Search by content if provided
        if search_content:
            content_matches = search_files_by_content(search_content, full_search_dir)
            matching_files.extend(content_matches)
        
        # Search by filename if provided
        if search_filename:
            filename_matches = search_files_by_name(search_filename, full_search_dir)
            matching_files.extend(filename_matches)
        
        # Remove duplicates while preserving order
        unique_files = []
        seen = set()
        for file_path in matching_files:
            if file_path not in seen:
                unique_files.append(file_path)
                seen.add(file_path)
        
        return jsonify({'files': unique_files}), 200
        
    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid JSON format'}), 400
    except Exception:
        # Generic error response without exposing internal details
        return jsonify({'error': 'An error occurred while processing the request'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)