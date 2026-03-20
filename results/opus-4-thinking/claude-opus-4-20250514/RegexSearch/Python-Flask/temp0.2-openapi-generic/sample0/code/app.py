from flask import Flask, request, jsonify
import os
import re
from pathlib import Path

app = Flask(__name__)

# Configuration
FILES_ROOT = './files'
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB limit per file

def is_safe_path(base_dir, path):
    """Check if a path is safe (doesn't escape base directory)"""
    try:
        # Resolve both paths to absolute
        base_path = Path(base_dir).resolve()
        target_path = (base_path / path).resolve()
        
        # Check if target path is under base path
        return target_path.parts[:len(base_path.parts)] == base_path.parts
    except Exception:
        return False

def search_files(regex_pattern, directory, recursive):
    """Search for files matching the regex pattern"""
    matching_files = []
    
    # Determine search directory
    if directory:
        search_dir = os.path.join(FILES_ROOT, directory)
        if not is_safe_path(FILES_ROOT, directory):
            raise ValueError("Invalid directory path")
    else:
        search_dir = FILES_ROOT
    
    # Check if directory exists
    if not os.path.exists(search_dir) or not os.path.isdir(search_dir):
        raise ValueError("Directory does not exist or is not accessible")
    
    # Compile regex
    try:
        pattern = re.compile(regex_pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    # Walk through directory
    if recursive:
        for root, dirs, files in os.walk(search_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                if check_file_matches(file_path, pattern):
                    # Get relative path from search directory
                    rel_path = os.path.relpath(file_path, search_dir)
                    matching_files.append(rel_path.replace('\\', '/'))  # Normalize path separators
    else:
        # Non-recursive search
        try:
            for item in os.listdir(search_dir):
                item_path = os.path.join(search_dir, item)
                if os.path.isfile(item_path):
                    if check_file_matches(item_path, pattern):
                        matching_files.append(item)
        except OSError as e:
            raise ValueError(f"Error accessing directory: {str(e)}")
    
    return matching_files

def check_file_matches(file_path, pattern):
    """Check if file content matches the regex pattern"""
    try:
        # Check file size first
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            return False
        
        # Try to read file as text
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return bool(pattern.search(content))
    except Exception:
        # If we can't read the file, skip it
        return False

@app.route('/search', methods=['GET'])
def search():
    # Get query parameters
    regex = request.args.get('regex')
    directory = request.args.get('directory', '')
    recursive = request.args.get('recursive', 'false').lower() == 'true'
    
    # Validate regex parameter is present
    if not regex:
        return jsonify({'error': 'regex parameter is required'}), 400
    
    try:
        # Perform search
        files = search_files(regex, directory, recursive)
        return jsonify({'files': files}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        # Log error in production
        app.logger.error(f"Internal error: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    if not os.path.exists(FILES_ROOT):
        os.makedirs(FILES_ROOT)
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)