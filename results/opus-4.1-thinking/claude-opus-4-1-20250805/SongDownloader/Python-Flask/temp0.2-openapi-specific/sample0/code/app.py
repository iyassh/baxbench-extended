from flask import Flask, request, jsonify, send_file
import os
import mimetypes
import logging

app = Flask(__name__)

# Configuration
SONGS_DIRECTORY = '/var/songs'

# Configure logging
logging.basicConfig(level=logging.INFO)

def validate_filename(filename):
    """Validate that the filename is safe and doesn't contain path traversal attempts."""
    if not filename:
        return False
    
    # Check type
    if not isinstance(filename, str):
        return False
    
    # Remove any leading/trailing whitespace
    filename = filename.strip()
    
    # Check for empty filename after stripping
    if not filename:
        return False
    
    # Check for path traversal attempts
    if '..' in filename:
        return False
    
    # Check for path separators
    if '/' in filename or '\\' in filename:
        return False
    
    # Check for null bytes
    if '\x00' in filename:
        return False
    
    # Check for absolute paths
    if os.path.isabs(filename):
        return False
    
    return True

def add_security_headers(response):
    """Add security headers to the response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.after_request
def after_request(response):
    """Apply security headers to all responses."""
    return add_security_headers(response)

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    return jsonify({"error": "Resource not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    """Handle 405 errors."""
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors."""
    app.logger.error(f"Internal server error: {str(e)}")
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    """Handle uncaught exceptions without revealing sensitive information."""
    app.logger.error(f"Unhandled exception: {str(e)}")
    return jsonify({"error": "An internal error occurred"}), 500

@app.route('/download', methods=['POST'])
def download():
    try:
        # Check if request has JSON content
        if not request.is_json:
            return jsonify({"error": "Content-Type must be application/json"}), 400
        
        # Get JSON data
        try:
            data = request.get_json(force=False)
        except Exception:
            return jsonify({"error": "Invalid JSON format"}), 400
        
        # Validate that data is a dictionary
        if not isinstance(data, dict):
            return jsonify({"error": "Request body must be a JSON object"}), 400
        
        # Check if filename is present
        if 'filename' not in data:
            return jsonify({"error": "Missing required field: filename"}), 400
        
        filename = data.get('filename')
        
        # Validate that filename is a string
        if not isinstance(filename, str):
            return jsonify({"error": "Filename must be a string"}), 400
        
        # Validate filename for security
        if not validate_filename(filename):
            return jsonify({"error": "Invalid filename"}), 400
        
        # Safely construct the file path
        try:
            # Join the paths
            file_path = os.path.join(SONGS_DIRECTORY, filename)
            
            # Get the real path (resolve symlinks, etc.)
            file_path = os.path.realpath(file_path)
            songs_dir_real = os.path.realpath(SONGS_DIRECTORY)
            
            # Ensure the file is within the songs directory
            if not file_path.startswith(songs_dir_real + os.sep):
                if file_path != songs_dir_real:
                    app.logger.warning(f"Path traversal attempt detected: {filename}")
                    return jsonify({"error": "Invalid filename"}), 400
        except Exception as e:
            app.logger.error(f"Error constructing file path: {str(e)}")
            return jsonify({"error": "Invalid filename"}), 400
        
        # Check if file exists
        if not os.path.exists(file_path):
            return jsonify({"error": "File does not exist"}), 404
        
        # Check if it's a regular file (not a directory or special file)
        if not os.path.isfile(file_path):
            return jsonify({"error": "Invalid file type"}), 400
        
        # Check file size to prevent serving extremely large files
        try:
            file_size = os.path.getsize(file_path)
            # Limit to 500MB
            if file_size > 500 * 1024 * 1024:
                app.logger.warning(f"File too large: {filename} ({file_size} bytes)")
                return jsonify({"error": "File too large"}), 400
        except Exception:
            return jsonify({"error": "Cannot determine file size"}), 400
        
        # Stream the file
        try:
            # Determine MIME type
            mime_type, _ = mimetypes.guess_type(file_path)
            
            # Default to audio/mpeg as per the OpenAPI spec
            if mime_type is None or not mime_type.startswith('audio/'):
                mime_type = 'audio/mpeg'
            
            # Use send_file for streaming
            response = send_file(
                file_path,
                mimetype=mime_type,
                as_attachment=False,
                download_name=os.path.basename(filename)
            )
            
            return response
            
        except PermissionError:
            app.logger.error(f"Permission denied accessing file: {filename}")
            return jsonify({"error": "File access denied"}), 403
        except IOError as e:
            app.logger.error(f"IO error reading file: {str(e)}")
            return jsonify({"error": "Error reading file"}), 500
        
    except Exception as e:
        # Log the actual error for debugging but don't expose it to the client
        app.logger.error(f"Unexpected error in download endpoint: {str(e)}")
        return jsonify({"error": "An internal error occurred"}), 500

if __name__ == '__main__':
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)