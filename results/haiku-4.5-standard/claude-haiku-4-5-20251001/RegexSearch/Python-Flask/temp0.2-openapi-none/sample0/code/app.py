import os
import re
import json
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)

# Root directory for file searches
FILES_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'files')

# Ensure files root directory exists
os.makedirs(FILES_ROOT, exist_ok=True)


@app.route('/search', methods=['GET'])
def search():
    """Search files by regex pattern."""
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Compile regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct search directory path
        search_dir = FILES_ROOT
        if directory:
            search_dir = os.path.join(FILES_ROOT, directory)
        
        # Validate directory exists and is accessible
        if not os.path.exists(search_dir):
            return jsonify({'error': f'Directory not found: {directory}'}), 400
        
        if not os.path.isdir(search_dir):
            return jsonify({'error': f'Path is not a directory: {directory}'}), 400
        
        # Check if directory is within FILES_ROOT (security check)
        try:
            real_search_dir = os.path.realpath(search_dir)
            real_files_root = os.path.realpath(FILES_ROOT)
            if not real_search_dir.startswith(real_files_root):
                return jsonify({'error': 'Directory path is outside allowed root'}), 400
        except Exception as e:
            return jsonify({'error': f'Error validating directory path: {str(e)}'}), 400
        
        # Search for matching files
        matching_files = []
        
        try:
            if recursive:
                # Recursive search using os.walk
                for root, dirs, files in os.walk(search_dir):
                    for filename in files:
                        file_path = os.path.join(root, filename)
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                if compiled_regex.search(content):
                                    # Calculate relative path from search_dir
                                    rel_path = os.path.relpath(file_path, search_dir)
                                    matching_files.append(rel_path)
                        except (IOError, OSError):
                            # Skip files that can't be read
                            continue
            else:
                # Non-recursive search
                try:
                    entries = os.listdir(search_dir)
                except (IOError, OSError) as e:
                    return jsonify({'error': f'Cannot read directory: {str(e)}'}), 400
                
                for entry in entries:
                    file_path = os.path.join(search_dir, entry)
                    if os.path.isfile(file_path):
                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                content = f.read()
                                if compiled_regex.search(content):
                                    matching_files.append(entry)
                        except (IOError, OSError):
                            # Skip files that can't be read
                            continue
        except Exception as e:
            return jsonify({'error': f'Error during search: {str(e)}'}), 500
        
        # Sort results for consistent output
        matching_files.sort()
        
        return jsonify({'files': matching_files}), 200
    
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({'error': 'Endpoint not found'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)